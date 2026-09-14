import io
import json
from datetime import datetime
from decimal import Decimal
from django.db import transaction
from django.db.models import Max
from django.http import HttpResponse
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from accounts.permissions import RoleSectionPermission, can_read, can_write
from accounts.mixins import SafeDestroyMixin
from .excel import (map_registry_header, import_registry, carry_over_payment, parse_amount_cell,
                    parse_date_cell, read_blocks, split_block, suggest_contract, classify,
                    REGISTRY_EXPORT)
from .models import (Customer, Contract, ContractPayment, ContractExpense, ContractFile, Comment,
                     Source)
from .serializers import (CustomerSerializer, ContractSerializer, ContractDetailSerializer,
                          ContractPaymentSerializer, ContractExpenseSerializer,
                          ContractFileSerializer, CommentSerializer, contract_money)

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _f(v):
    return float(round(Decimal(v), 2))


def _load_sheet(request):
    from openpyxl import load_workbook
    file = request.FILES.get("file")
    if not file:
        return None, Response({"detail": "Файл не передан."}, status=400)
    try:
        return load_workbook(file, data_only=True).active, None
    except Exception:
        return None, Response({"detail": "Не удалось открыть файл. Нужен формат .xlsx."}, status=400)


class Base(SafeDestroyMixin, viewsets.ModelViewSet):
    permission_classes = [RoleSectionPermission]
    section = "contracts"


class CustomerViewSet(Base):
    access_key = "contracts.customers"
    queryset = Customer.objects.all().order_by("name")
    serializer_class = CustomerSerializer
    search_fields = ["name", "bin_iin", "phone"]


class ContractViewSet(Base):
    access_key = "contracts.contracts"
    queryset = (Contract.objects.select_related("customer", "manager", "own_company")
                .prefetch_related("payments", "expenses"))
    filterset_fields = {"status": ["exact", "in"], "customer": ["exact"], "manager": ["exact"],
                        "own_company": ["exact"]}
    search_fields = ["number", "purchase_no", "contract_no", "title", "customer__name", "investor"]

    def get_serializer_class(self):
        return ContractDetailSerializer if self.action == "retrieve" else ContractSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "retrieve":
            qs = qs.prefetch_related("files__uploaded_by", "comments__author")
        return qs

    @action(detail=True, methods=["post"])
    def set_status(self, request, pk=None):
        """Смена статуса по цепочке."""
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
        contract = self.get_queryset().get(pk=contract.pk)
        return Response(ContractDetailSerializer(contract, context=self.get_serializer_context()).data)

    @action(detail=False, methods=["get"])
    def summary(self, request):
        """Итог по отобранным договорам — строка «Итого» под реестром."""
        rows = list(self.filter_queryset(self.get_queryset()))
        total = {"count": len(rows), "amount": 0.0}
        sums = {}
        for c in rows:
            total["amount"] += float(c.amount)
            for k, v in contract_money(c, request.user).items():
                if v is not None:
                    sums[k] = sums.get(k, 0.0) + v
                else:
                    sums.setdefault(k, None)
        total["amount"] = round(total["amount"], 2)
        total.update({k: (round(v, 2) if v is not None else None) for k, v in sums.items()})
        return Response(total)

    @action(detail=False, methods=["get"])
    def export_excel(self, request):
        """Выгрузка в виде реестра «Договора.xlsx» — её же можно поправить и загрузить обратно."""
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.title = "Договора"
        ws.append(REGISTRY_EXPORT)
        for c in self.filter_queryset(self.get_queryset()):
            m = contract_money(c, request.user)
            ws.append([c.purchase_no or c.number, c.own_company.name if c.own_company else "",
                       c.platform, c.customer.name, c.title,
                       float(c.qty) if c.qty is not None else None,
                       float(c.price) if c.price is not None else None, float(c.amount),
                       c.costs_note, c.comment, c.investor, c.payment_note, c.delivery_place,
                       c.note, c.delivery_terms, c.contract_no, c.phone, c.signed_date,
                       c.planned_execution or (c.deadline.strftime("%d.%m.%Y") if c.deadline else ""),
                       c.get_status_display(), m["paid"], m["expenses"], m["profit"]])
        buf = io.BytesIO()
        wb.save(buf)
        resp = HttpResponse(buf.getvalue(), content_type=XLSX)
        resp["Content-Disposition"] = 'attachment; filename="contracts.xlsx"'
        return resp

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser])
    def import_excel(self, request):
        """Загрузка реестра. Русские заголовки «Договора.xlsx» узнаются по названию;
        старый формат с английскими колонками (number, customer…) тоже принимается.

        carry_over=1 — режим переноса истории: статус берётся из файла как есть,
        даже если по цепочке такой переход запрещён.
        """
        ws, err = _load_sheet(request)
        if err:
            return err
        carry_over = str(request.data.get("carry_over", "")).lower() in ("1", "true", "on")
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            return Response({"detail": "Файл пуст."}, status=400)

        mapping, extra = map_registry_header(rows[0])
        if "purchase_no" in mapping or ("title" in mapping and "customer" in mapping):
            with transaction.atomic():
                created, updated, errors = import_registry(rows, mapping, extra, carry_over)
            return Response({"created": created, "updated": updated, "errors": errors})

        header = [str(h).strip().lower() if h else "" for h in rows[0]]
        if "number" not in header:
            return Response({"detail": "Не узнал колонки. Нужен реестр с колонками «Номер закупки», "
                                       "«Организация», «Предмет закупки»…"}, status=400)
        created, updated, errors = 0, 0, []
        for i, row in enumerate(rows[1:], start=2):
            data = dict(zip(header, row))
            try:
                number = str(data.get("number") or "").strip()
                if not number:
                    continue
                customer, _ = Customer.objects.get_or_create(
                    name=str(data.get("customer") or "Без имени").strip())
                defaults = {"customer": customer, "title": str(data.get("title") or "")[:255],
                            "amount": parse_amount_cell(data.get("amount")),
                            "specification": str(data.get("specification") or "")}
                for f in ("signed_date", "deadline"):
                    v = data.get(f)
                    if isinstance(v, datetime):
                        defaults[f] = v.date()
                    elif isinstance(v, str) and v.strip():
                        d = parse_date_cell(v)
                        if d is None:
                            errors.append(f"строка {i}: дату «{v.strip()}» разобрать не удалось.")
                        else:
                            defaults[f] = d
                existing = Contract.objects.filter(number=number).first()
                st = str(data.get("status") or "").strip()
                if st in dict(Contract.Status.choices):
                    e = None if (existing is None or carry_over) else existing.transition_error(st)
                    if e:
                        errors.append(f"строка {i}: {e} Статус не изменён.")
                    else:
                        defaults["status"] = st
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
            except Exception as e:  # noqa: BLE001
                errors.append(f"строка {i}: {e}")
        return Response({"created": created, "updated": updated, "errors": errors})


class ContractPaymentViewSet(Base):
    access_key = "contracts.payments"
    queryset = ContractPayment.objects.select_related("contract")
    serializer_class = ContractPaymentSerializer
    filterset_fields = ["contract", "source"]


class ContractExpenseViewSet(Base):
    access_key = "contracts.expenses"
    queryset = ContractExpense.objects.select_related("contract")
    serializer_class = ContractExpenseSerializer
    filterset_fields = {"contract": ["exact"], "kind": ["exact"], "source": ["exact"],
                        "date": ["gte", "lte", "isnull"]}
    search_fields = ["comment", "contract__number", "contract__title"]

    def _rights(self, request):
        if not (can_write(request.user, "contracts.expenses")
                and can_write(request.user, "contracts.payments")):
            return Response({"detail": "Загрузка «Расходов» пишет и расходы, и оплаты — "
                                       "нужно право на оба."}, status=403)
        return None

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser])
    def import_preview(self, request):
        """Шаг 1 загрузки «Расходы.xlsx»: какие колонки есть в файле и с каким
        договором каждая, похоже, связана. В базу ничего не пишется."""
        denied = self._rights(request)
        if denied:
            return denied
        ws, err = _load_sheet(request)
        if err:
            return err
        blocks = read_blocks(ws)
        if not blocks:
            return Response({"detail": "Не нашёл колонок: названия заказов должны быть в первой "
                                       "строке, под каждым — сумма и комментарий."}, status=400)
        contracts = list(Contract.objects.select_related("customer"))
        out = []
        for i, (name, lines) in enumerate(blocks):
            exp, inc, warnings = split_block(lines)
            sug = suggest_contract(name, contracts)
            out.append({
                "index": i, "name": name,
                "expenses_count": len(exp), "expenses_total": _f(sum((a for a, _ in exp), Decimal(0))),
                "incomes_count": len(inc), "incomes_total": _f(sum((a for a, _ in inc), Decimal(0))),
                "warnings": warnings,
                "suggestion": sug.id if sug else None,
                "suggestion_label": (f"{sug.purchase_no or sug.number} · {sug.customer.name} · {sug.title}"
                                     if sug else None),
            })
        return Response({"blocks": out})

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser])
    def import_apply(self, request):
        """Шаг 2: записать колонки в выбранные договоры.

        mapping — {"номер колонки": id договора}; колонки без договора пропускаются.
        У договора заменяются только строки, загруженные из Excel раньше,
        внесённое руками остаётся.
        """
        denied = self._rights(request)
        if denied:
            return denied
        ws, err = _load_sheet(request)
        if err:
            return err
        try:
            mapping = json.loads(request.data.get("mapping") or "{}")
        except ValueError:
            return Response({"detail": "Сопоставление колонок передано неверно."}, status=400)
        blocks = read_blocks(ws)
        ids = {int(v) for v in mapping.values() if v}
        contracts = {c.id: c for c in Contract.objects.filter(id__in=ids)}
        if len(contracts) != len(ids):
            return Response({"detail": "Среди выбранных договоров есть несуществующий."}, status=400)

        rep = {"contracts": 0, "expenses": 0, "incomes": 0, "skipped": 0, "warnings": []}
        with transaction.atomic():
            cleared = set()
            for i, (name, lines) in enumerate(blocks):
                cid = mapping.get(str(i))
                if not cid:
                    rep["skipped"] += 1
                    continue
                contract = contracts[int(cid)]
                if contract.id not in cleared:
                    ContractExpense.objects.filter(contract=contract, source=Source.EXCEL).delete()
                    ContractPayment.objects.filter(contract=contract, source=Source.EXCEL).delete()
                    cleared.add(contract.id)
                exp, inc, warnings = split_block(lines)
                top = (ContractExpense.objects.filter(contract=contract)
                       .aggregate(m=Max("position"))["m"] or 0)
                ContractExpense.objects.bulk_create([
                    ContractExpense(contract=contract, amount=a, comment=t[:255], kind=classify(t),
                                    source=Source.EXCEL, position=top + n, date=None)
                    for n, (a, t) in enumerate(exp, start=1)])
                ContractPayment.objects.bulk_create([
                    ContractPayment(contract=contract, amount=a, comment=t[:255],
                                    source=Source.EXCEL, date=None)
                    for a, t in inc])
                rep["expenses"] += len(exp)
                rep["incomes"] += len(inc)
                rep["warnings"] += [f"«{name}», {w}" for w in warnings]
            rep["contracts"] = len(cleared)
        return Response(rep)


class ContractFileViewSet(Base):
    access_key = "contracts.files"
    queryset = ContractFile.objects.all()
    serializer_class = ContractFileSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    filterset_fields = ["contract", "kind"]

    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)


class CommentViewSet(Base):
    access_key = "contracts.comments"
    queryset = Comment.objects.select_related("author", "contract")
    serializer_class = CommentSerializer
    filterset_fields = ["contract", "importance"]

    def perform_create(self, serializer):
        serializer.save(author=self.request.user)
