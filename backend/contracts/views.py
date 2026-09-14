import io
import re
from datetime import datetime, date
from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from accounts.permissions import RoleSectionPermission
from accounts.mixins import SafeDestroyMixin
from .models import Customer, Contract, PaymentScheduleItem, ContractFile, Comment
from .serializers import (CustomerSerializer, ContractSerializer, ContractDetailSerializer,
                          PaymentScheduleItemSerializer, ContractFileSerializer, CommentSerializer)

EXPORT_HEADERS = ["number", "customer", "title", "status", "amount",
                  "signed_date", "deadline", "specification"]


def parse_amount_cell(value):
    """Сумма из ячейки. Люди копируют её из отчётов вместе с пробелами
    и знаком тенге: «450 000 ₸». Раньше такая строка роняла весь договор."""
    if value is None or value == "":
        return 0
    if isinstance(value, (int, float)):
        return value
    text = (str(value).replace("\xa0", "").replace(" ", "")
            .replace("₸", "").replace("тг", "").replace(",", "."))
    try:
        return float(text)
    except ValueError:
        return 0


CARRY_OVER_NOTE = "Перенос из прежнего учёта"


def carry_over_payment(contract, raw_paid):
    """Перенести из файла то, что по договору уже оплачено.

    Выгрузка колонку paid_amount пишет, а импорт её раньше не читал — при
    переносе истории оплаченный договор выглядел неоплаченным, и воронка
    считала уже полученные деньги ожидаемыми.

    Оплаты живут в графике платежей, поэтому заводим одну строку на всю
    сумму договора с отметкой о переносе. Повторная загрузка того же файла
    её обновляет, а не добавляет вторую: строка узнаётся по этой отметке.
    """
    paid = parse_amount_cell(raw_paid)
    item = contract.payment_schedule.filter(note=CARRY_OVER_NOTE).first()
    if not paid:
        if item:
            item.delete()
        return
    if contract.amount <= 0:
        return
    due = contract.deadline or contract.signed_date or timezone.localdate()
    values = dict(amount=contract.amount, paid_amount=min(paid, contract.amount),
                  due_date=due, paid_date=contract.signed_date or due)
    if item:
        for k, v in values.items():
            setattr(item, k, v)
        item.save()
    else:
        PaymentScheduleItem.objects.create(contract=contract, note=CARRY_OVER_NOTE, **values)


def parse_date_cell(value):
    """Дата из текстовой ячейки. None, если формат непонятен.

    Ячейку с настоящим форматом даты Excel отдаёт как datetime — её разбирать
    не надо. Текстом дату пишут по-разному, и раньше принимался только
    ISO-вид: строка с «15.09.2026» роняла весь договор, а не одно поле.
    """
    text = str(value).strip()[:10]
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


# ── Реестр «Договора.xlsx» ─────────────────────────────────────────────────
# Одна строка — одна позиция закупки. Колонки узнаются по названию, опечатки
# в заголовках («Коментарий», «Дата подписаний») допустимы.
REGISTRY_FIELDS = [
    ("purchase_no", ("номер закупки",)),
    ("own_company", ("с какой фирмы", "от какой фирмы")),
    ("platform", ("площадка",)),
    ("customer", ("организация", "заказчик")),
    ("title", ("предмет закупки", "наименование товара", "предмет")),
    ("qty", ("кол-во", "количество")),
    ("price", ("цена",)),
    ("amount", ("без ндс сумма", "сумма")),
    ("costs_note", ("затраты",)),
    ("comment", ("комментарии",)),
    ("investor", ("инвестор",)),
    ("payment_note", ("оплата",)),
    ("delivery_place", ("место поставки",)),
    ("note", ("коментарий", "комментарий", "примечание")),
    ("delivery_terms", ("срок поставки",)),
    ("contract_no", ("номер договора",)),
    ("phone", ("телефон",)),
    ("signed_date", ("дата подписан",)),
    ("planned_execution", ("планируемый срок",)),
    ("status", ("статус",)),
    ("paid_amount", ("оплачено",)),
    ("project", ("проект",)),
]
# Эти колонки в реестре — расчётные: прибыль и остаток считаются по проекту
REGISTRY_IGNORED = ("прибыль", "остаток", "минусовой")

REGISTRY_EXPORT = ["Номер закупки", "С какой фирмы выиграли", "Площадка", "Организация",
                   "Предмет закупки", "Кол-во", "Цена", "Без НДС сумма тг", "Затраты",
                   "Комментарии", "Инвестор", "Оплата", "Место поставки", "Коментарий",
                   "Срок поставки", "Номер договора", "Телефон", "Дата подписания договора",
                   "Планируемый срок исполнения", "Статус", "Оплачено", "Проект"]


def _norm(h):
    return re.sub(r"\s+", " ", str(h or "").strip().lower().replace("ё", "е"))


def _text(v):
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.strftime("%d.%m.%Y")
    return str(v).strip()


def map_registry_header(header):
    """{поле: номер колонки} и колонки без заголовка — в файле туда пишут
    «допик», «написал о продлении»; их текст уходит в примечание."""
    norm = [_norm(h) for h in header]
    mapping, taken = {}, set()
    for field, variants in REGISTRY_FIELDS:
        for i, h in enumerate(norm):
            if i in taken or not h or any(w in h for w in REGISTRY_IGNORED):
                continue
            if h in variants or any(len(v) >= 6 and v in h for v in variants):
                mapping[field] = i
                taken.add(i)
                break
    extra = [i for i, h in enumerate(norm) if not h]
    return mapping, extra


def partial_date(value, year):
    """Дата из ячейки реестра: настоящая дата, «15.09.2026» или «23.03.» без года."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = _text(value)
    if not text:
        return None
    full = parse_date_cell(text)
    if full:
        return full
    m = re.match(r"^(\d{1,2})\.(\d{1,2})\.?$", text)
    if m:
        try:
            return date(year, int(m.group(2)), int(m.group(1)))
        except ValueError:
            return None
    return None


def import_registry(rows, mapping, extra, carry_over):
    from projects.calc import money
    from projects.models import Project
    from tenders.models import OwnCompany

    today = timezone.localdate()
    labels = {label.lower(): code for code, label in Contract.Status.choices}
    created = updated = 0
    errors = []

    def get(row, field):
        i = mapping.get(field)
        return row[i] if i is not None and i < len(row) else None

    for n, row in enumerate(rows[1:], start=2):
        if not any(v not in (None, "") for v in row):
            continue
        purchase_no = _text(get(row, "purchase_no"))[:100]
        title = _text(get(row, "title"))[:255]
        if not purchase_no and not title:
            continue
        try:
            qty, price, amount = (money(get(row, k)) for k in ("qty", "price", "amount"))
            if amount is None and qty is not None and price is not None:
                amount = qty * price
            signed = partial_date(get(row, "signed_date"), today.year)
            planned_raw = get(row, "planned_execution")
            deadline = partial_date(planned_raw, signed.year if signed else today.year)

            customer, _ = Customer.objects.get_or_create(
                name=(_text(get(row, "customer")) or "Без имени")[:255])
            company = None
            company_name = _text(get(row, "own_company"))
            if company_name:
                company = (OwnCompany.objects.filter(name__iexact=company_name).first()
                           or OwnCompany.objects.create(name=company_name[:150]))
            extras = [_text(row[i]) for i in extra if i < len(row) and _text(row[i])]
            values = {
                "customer": customer, "title": title or "(без предмета)",
                "amount": amount or 0, "qty": qty, "price": price,
                "purchase_no": purchase_no, "own_company": company,
                "note": "\n".join(t for t in [_text(get(row, "note"))] + extras if t),
                "planned_execution": _text(planned_raw)[:100],
            }
            for field, size in (("platform", 100), ("contract_no", 100), ("costs_note", 100),
                                ("investor", 150), ("payment_note", 100), ("delivery_place", 255),
                                ("phone", 255)):
                values[field] = _text(get(row, field))[:size]
            for field in ("comment", "delivery_terms"):
                values[field] = _text(get(row, field))
            if signed:
                values["signed_date"] = signed
            if deadline:
                values["deadline"] = deadline
            project_name = _text(get(row, "project"))
            if project_name:
                values["project"] = (Project.objects.filter(name__iexact=project_name).first()
                                     or Project.objects.create(name=project_name[:200]))

            # Своя позиция узнаётся по закупке, предмету, количеству и цене:
            # у №000061174 две позиции одного костюма — на 80 и на 547 штук.
            # Записи, загруженные до реестра, количества не знают — их узнаём
            # по сумме, чтобы статус и оплаты остались у правильной позиции.
            base = Contract.objects.filter(title=values["title"], purchase_no=purchase_no)
            match = base.filter(qty=qty, price=price).first() if qty is not None else None
            if match is None:
                match = base.filter(qty__isnull=True, amount=values["amount"]).first()

            st_raw = _text(get(row, "status")).lower()
            st = st_raw if st_raw in dict(Contract.Status.choices) else labels.get(st_raw)
            if st:
                err = None if (match is None or carry_over) else match.transition_error(st)
                if err:
                    errors.append(f"строка {n}: {err} Статус не изменён. "
                                  "Если это перенос истории, включите режим переноса.")
                else:
                    values["status"] = st

            if match:
                for k, v in values.items():
                    setattr(match, k, v)
                match.save()
                contract = match
                updated += 1
            else:
                number = purchase_no or values["contract_no"] or f"Позиция {n}"
                contract = Contract.objects.create(number=number[:100], **values)
                created += 1
            if "paid_amount" in mapping:
                carry_over_payment(contract, get(row, "paid_amount"))
        except Exception as e:  # noqa: BLE001 — строка с ошибкой не роняет весь реестр
            errors.append(f"строка {n}: {e}")
    return created, updated, errors


class CustomerViewSet(SafeDestroyMixin, viewsets.ModelViewSet):
    access_key = "contracts.customers"
    queryset = Customer.objects.all().order_by("name")
    serializer_class = CustomerSerializer
    permission_classes = [RoleSectionPermission]
    section = "contracts"
    search_fields = ["name", "bin_iin", "phone"]


class ContractViewSet(SafeDestroyMixin, viewsets.ModelViewSet):
    access_key = "contracts.contracts"
    queryset = (Contract.objects.select_related("customer", "manager", "own_company", "project")
                .prefetch_related("payment_schedule"))
    permission_classes = [RoleSectionPermission]
    section = "contracts"
    filterset_fields = {"status": ["exact"], "customer": ["exact"], "manager": ["exact"],
                        "own_company": ["exact"], "project": ["exact", "isnull"]}
    search_fields = ["number", "purchase_no", "contract_no", "title", "customer__name", "investor"]

    def get_serializer_class(self):
        return ContractDetailSerializer if self.action == "retrieve" else ContractSerializer

    @action(detail=True, methods=["post"])
    def set_status(self, request, pk=None):
        """Смена статуса строго по цепочке: new → negotiation → in_progress → closed/cancelled."""
        contract = self.get_object()
        new_status = request.data.get("status")
        if new_status not in dict(Contract.Status.choices):
            return Response({"detail": "Неизвестный статус договора."},
                            status=status.HTTP_400_BAD_REQUEST)
        err = contract.transition_error(new_status)
        if err:
            return Response({"detail": err}, status=status.HTTP_400_BAD_REQUEST)
        contract.status = new_status
        contract.save(update_fields=["status", "updated_at"])
        return Response(ContractDetailSerializer(contract).data)

    @action(detail=False, methods=["get"])
    def export_excel(self, request):
        """Выгрузка в виде реестра «Договора.xlsx» — те же колонки, что у вас
        в таблице, плюс статус, оплачено и проект. Её же можно поправить
        и загрузить обратно."""
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.title = "Договора"
        ws.append(REGISTRY_EXPORT)
        for c in self.filter_queryset(self.get_queryset()):
            ws.append([c.purchase_no or c.number, c.own_company.name if c.own_company else "",
                       c.platform, c.customer.name, c.title,
                       float(c.qty) if c.qty is not None else None,
                       float(c.price) if c.price is not None else None, float(c.amount),
                       c.costs_note, c.comment, c.investor, c.payment_note, c.delivery_place,
                       c.note, c.delivery_terms, c.contract_no, c.phone, c.signed_date,
                       c.planned_execution or (c.deadline.strftime("%d.%m.%Y") if c.deadline else ""),
                       c.get_status_display(), float(c.paid_amount),
                       c.project.name if c.project else ""])
        buf = io.BytesIO()
        wb.save(buf)
        resp = HttpResponse(buf.getvalue(),
                            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        resp["Content-Disposition"] = 'attachment; filename="contracts.xlsx"'
        return resp

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser])
    def import_excel(self, request):
        """Массовая загрузка: колонки number, customer, title, status, amount,
        paid_amount, signed_date, deadline, specification.

        Поле формы carry_over=1 включает режим переноса истории: статус берётся
        из файла как есть, даже если по цепочке такой переход запрещён. Нужно
        при переезде с прежнего учёта — договоры туда попадают уже выполненными,
        и проводить каждый через согласование бессмысленно.
        """
        from openpyxl import load_workbook
        file = request.FILES.get("file")
        if not file:
            return Response({"detail": "Файл не передан (поле file)."}, status=400)
        carry_over = str(request.data.get("carry_over", "")).lower() in ("1", "true", "on")
        wb = load_workbook(file, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            return Response({"detail": "Файл пуст."}, status=400)

        # Реестр в том виде, в каком его ведут: русские заголовки, позиция на строку
        mapping, extra = map_registry_header(rows[0])
        if "purchase_no" in mapping or ("title" in mapping and "customer" in mapping):
            created, updated, errors = import_registry(rows, mapping, extra, carry_over)
            return Response({"created": created, "updated": updated, "errors": errors})

        header = [str(h).strip().lower() if h else "" for h in rows[0]]
        created, updated, errors = 0, 0, []
        for i, row in enumerate(rows[1:], start=2):
            data = dict(zip(header, row))
            try:
                number = str(data.get("number") or "").strip()
                if not number:
                    continue
                customer, _ = Customer.objects.get_or_create(name=str(data.get("customer") or "Без имени").strip())
                defaults = {
                    "customer": customer,
                    "title": str(data.get("title") or "")[:255],
                    "amount": parse_amount_cell(data.get("amount")),
                    "specification": str(data.get("specification") or ""),
                }
                for f in ("signed_date", "deadline"):
                    v = data.get(f)
                    if isinstance(v, datetime):
                        defaults[f] = v.date()
                    elif isinstance(v, str) and v.strip():
                        d = parse_date_cell(v)
                        if d is None:
                            errors.append(f"строка {i}: дату «{v.strip()}» разобрать не удалось, "
                                          "поле оставлено пустым. Ожидается 2026-09-15 или 15.09.2026.")
                        else:
                            defaults[f] = d

                # Статус подчиняется той же цепочке, что и кнопки в карточке.
                # У нового договора он может быть любым — в систему вносят и те,
                # что давно в работе. У существующего запрещённый переход не
                # применяется молча: строка загружается, статус остаётся прежним,
                # а причина попадает в список замечаний.
                existing = Contract.objects.filter(number=number).first()
                st = str(data.get("status") or "").strip()
                if st in dict(Contract.Status.choices):
                    if existing is None or carry_over:
                        defaults["status"] = st
                    else:
                        err = existing.transition_error(st)
                        if err:
                            errors.append(f"строка {i}: {err} Статус договора не изменён. "
                                          "Если это перенос истории, включите режим переноса.")
                        else:
                            defaults["status"] = st

                # номер больше не уникален — берём первую запись с ним
                if existing:
                    for k, v in defaults.items():
                        setattr(existing, k, v)
                    existing.save()
                    contract = existing
                    updated += 1
                else:
                    contract = Contract.objects.create(number=number, **defaults)
                    created += 1

                carry_over_payment(contract, data.get("paid_amount"))
            except Exception as e:
                errors.append(f"строка {i}: {e}")
        return Response({"created": created, "updated": updated, "errors": errors})


class PaymentScheduleViewSet(SafeDestroyMixin, viewsets.ModelViewSet):
    access_key = "contracts.schedule"
    queryset = PaymentScheduleItem.objects.select_related("contract")
    serializer_class = PaymentScheduleItemSerializer
    permission_classes = [RoleSectionPermission]
    section = "contracts"
    filterset_fields = ["contract"]

    def _register_cash(self, item, delta):
        """Оплата по графику автоматически попадает в кассу (Cash Flow)."""
        from django.utils import timezone
        from finance.models import CashEntry
        if delta > 0:
            CashEntry.objects.create(
                direction="in", amount=delta,
                date=item.paid_date or timezone.localdate(),
                contract=item.contract,
                description=f"Оплата по графику, договор №{item.contract.number}")

    def perform_create(self, serializer):
        item = serializer.save()
        self._register_cash(item, item.paid_amount)

    def perform_update(self, serializer):
        old_paid = serializer.instance.paid_amount
        item = serializer.save()
        self._register_cash(item, item.paid_amount - old_paid)


class ContractFileViewSet(SafeDestroyMixin, viewsets.ModelViewSet):
    access_key = "contracts.files"
    queryset = ContractFile.objects.all()
    serializer_class = ContractFileSerializer
    permission_classes = [RoleSectionPermission]
    section = "contracts"
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    filterset_fields = ["contract", "kind"]

    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)


class CommentViewSet(SafeDestroyMixin, viewsets.ModelViewSet):
    access_key = "contracts.comments"
    queryset = Comment.objects.select_related("author", "contract")
    serializer_class = CommentSerializer
    permission_classes = [RoleSectionPermission]
    section = "contracts"
    filterset_fields = ["contract", "importance"]

    def perform_create(self, serializer):
        serializer.save(author=self.request.user)
