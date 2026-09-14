"""Разбор таблиц заказчика: реестр «Договора.xlsx» и «Расходы.xlsx».

Реестр — одна строка на позицию закупки, колонки узнаются по названию.
Расходы — пары колонок «сумма | комментарий» под названием заказа;
при загрузке каждую пару сопоставляют с договором.
"""
import re
from datetime import datetime, date
from decimal import Decimal, InvalidOperation
from django.utils import timezone

ZERO = Decimal("0")


# ── Числа и даты из ячеек ───────────────────────────────────────────────
def money(value):
    """Сумма из ячейки: «2 940,00», «1 440 000,00₸», 750 — всё в Decimal.
    Непонятное — None, чтобы строку можно было отметить, а не записать ноль."""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float, Decimal)):
        return Decimal(str(value))
    text = (str(value).replace("\xa0", "").replace(" ", "").replace("₸", "")
            .replace("тг", "").replace(",", "."))
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def parse_amount_cell(value):
    """Сумма или 0 — для колонок, где пустое значит «ничего»."""
    return money(value) or ZERO


def parse_date_cell(value):
    """Дата из текстовой ячейки: 2026-09-15, 15.09.2026, 15/09/2026. None — не разобрать."""
    text = str(value).strip()[:10]
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def cell_text(v):
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.strftime("%d.%m.%Y")
    return str(v).strip()


def partial_date(value, year):
    """Дата из ячейки реестра: настоящая дата, «15.09.2026» или «23.03.» без года."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = cell_text(value)
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


# ── Вид траты по комментарию ────────────────────────────────────────────
# В таблице у траты только сумма и пара слов. Чтобы увидеть, куда уходят
# деньги, вид определяется по этим словам; его всегда можно поправить.
# Порядок важен: «дост образец» — это доставка, «берцы 50%» — закуп.
_RULES = [
    ("legal", ["пеня", "пени", "суд", "пошл", "юрист", "нотар", "гарант", "экспертиз", "штамп",
               "справк", "реестр"]),
    ("travel", ["гостиниц", "билет", "поезд", "еда", "командир", "продукты"]),
    ("sewing", ["пошив", "крой", "переделк", "швея", "швеям", "швеи", "надомн", "вышив",
                "распарив", "пробация"]),
    ("packaging", ["упак", "пакет", "коробк", "скотч", "мешк"]),
    ("purchase", ["закуп", "перч", "берц", "шапк", "товар", "ботинк", "обув", "трусы", "нательн",
                  "одеало", "фильтр", "машинк", "оборуд"]),
    ("percent", ["%", "серт", "комис", "взнос"]),
    ("accessories", ["фурн", "пугов", "молни", "липучк", "шевр", "петл", "глазк", "этикет",
                     "бирк", "лого", "печат", "кант", "резинк", "нитк"]),
    ("fabric", ["ткан", "синт", "флис", "бязь", "поролон", "сетка"]),
    ("samples", ["образ", "обр ", "лекал", "протокол"]),
    ("delivery", ["дост", "такси", "курьер", "газел", "карго", "авиа", "выгрузк", "разгрузк",
                  "дорог", "почта"]),
]


def classify(comment):
    text = (comment or "").lower().strip()
    if not text:
        return "other"
    if text.startswith("дост") or "доставк" in text:
        return "delivery"
    if text in ("обр", "образец", "образцы"):
        return "samples"
    for kind, words in _RULES:
        if any(w in text for w in words):
            return kind
    return "other"


# ── Лист «колонками»: название в первой строке, под ним сумма и комментарий ─
TOTAL_WORDS = ("расход", "расходы", "итого", "итог", "остаток")


def read_blocks(ws):
    """[(название, [(номер строки, сумма|None, комментарий), ...]), ...]

    Каждый блок — две колонки: сумма и комментарий, название над суммой
    (в файле оно объединено на обе колонки)."""
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    header = list(rows[0])
    blocks, c = [], 0
    while c < len(header):
        name = header[c]
        if name is not None and str(name).strip():
            lines = []
            for r, row in enumerate(rows[1:], start=2):
                amount = row[c] if c < len(row) else None
                text = row[c + 1] if c + 1 < len(row) else None
                if (amount is None or str(amount).strip() == "") and (text is None or str(text).strip() == ""):
                    continue
                lines.append((r, amount, "" if text is None else str(text).strip()))
            blocks.append((str(name).strip(), lines))
            c += 2
        else:
            c += 1
    return blocks


def split_block(lines):
    """Строки блока «Расходов» → расходы, приход и замечания.

    «приход» — оплата заказчика; «расход» и «остаток» — итоги таблицы:
    их не записываем, а сверяем «расход» с суммой строк выше.
    """
    expenses, incomes, warnings = [], [], []
    running = ZERO
    for row, raw, text in lines:
        low = text.lower().strip()
        amount = money(raw)
        if low in TOTAL_WORDS:
            if low != "остаток" and amount is not None and amount != running:
                warnings.append(f"строка {row}: в таблице «{text}» {_sp(amount)}, "
                                f"а сумма строк выше — {_sp(running)}")
            continue
        if amount is None:
            if raw not in (None, ""):
                warnings.append(f"строка {row}: «{raw}» — не число, пропущено")
            continue
        if amount <= 0:
            warnings.append(f"строка {row}: сумма {raw} не больше нуля, пропущено")
            continue
        if low.startswith("приход"):
            incomes.append((amount, text))
        else:
            expenses.append((amount, text))
            running += amount
    return expenses, incomes, warnings


def _sp(v):
    return f"{v:,.0f}".replace(",", " ")


# ── Подсказка: какому договору принадлежит колонка «Расходов» ───────────
_STOP = {"частный", "заказ", "новый", "новые", "енбек", "образцы"}


def _tokens(s):
    return {w for w in re.findall(r"[a-zа-я0-9]+", (s or "").lower().replace("ё", "е"))
            if len(w) >= 4 and w not in _STOP}


def suggest_contract(name, contracts):
    """Договор, на который больше всего похоже название колонки: «Павлодар 741 шт»
    найдёт заказчика из Павлодара. Совпадение по началу слова — падежи не мешают."""
    want = _tokens(name)
    if not want:
        return None
    best, score = None, 0
    for c in contracts:
        have = _tokens(" ".join([c.customer.name, c.title, c.delivery_place, c.purchase_no,
                                 c.note, c.comment, c.investor]))
        s = sum(1 for w in want if any(h[:5] == w[:5] for h in have))
        if s > score:
            best, score = c, s
    return best


# ── Реестр «Договора.xlsx» ──────────────────────────────────────────────
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
]
# Эти колонки в реестре — расчётные: прибыль и остаток считаются по расходам договора
REGISTRY_IGNORED = ("прибыль", "остаток", "минусовой")

REGISTRY_EXPORT = ["Номер закупки", "С какой фирмы выиграли", "Площадка", "Организация",
                   "Предмет закупки", "Кол-во", "Цена", "Без НДС сумма тг", "Затраты",
                   "Комментарии", "Инвестор", "Оплата", "Место поставки", "Коментарий",
                   "Срок поставки", "Номер договора", "Телефон", "Дата подписания договора",
                   "Планируемый срок исполнения", "Статус", "Оплачено", "Расходы", "Прибыль"]


def _norm(h):
    return re.sub(r"\s+", " ", str(h or "").strip().lower().replace("ё", "е"))


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


CARRY_OVER_NOTE = "Перенос из прежнего учёта"


def carry_over_payment(contract, raw_paid):
    """Перенести из файла то, что по договору уже оплачено: одна строка оплаты
    с отметкой о переносе. Повторная загрузка её обновляет, а не добавляет вторую."""
    from .models import ContractPayment
    paid = parse_amount_cell(raw_paid)
    item = contract.payments.filter(comment=CARRY_OVER_NOTE).first()
    if not paid:
        if item:
            item.delete()
        return
    values = dict(amount=paid, date=contract.signed_date)
    if item:
        for k, v in values.items():
            setattr(item, k, v)
        item.save()
    else:
        ContractPayment.objects.create(contract=contract, comment=CARRY_OVER_NOTE, **values)


def import_registry(rows, mapping, extra, carry_over):
    from tenders.models import OwnCompany
    from .models import Contract, Customer

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
        purchase_no = cell_text(get(row, "purchase_no"))[:100]
        title = cell_text(get(row, "title"))[:255]
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
                name=(cell_text(get(row, "customer")) or "Без имени")[:255])
            company = None
            company_name = cell_text(get(row, "own_company"))
            if company_name:
                company = (OwnCompany.objects.filter(name__iexact=company_name).first()
                           or OwnCompany.objects.create(name=company_name[:150]))
            extras = [cell_text(row[i]) for i in extra if i < len(row) and cell_text(row[i])]
            values = {
                "customer": customer, "title": title or "(без предмета)",
                "amount": amount or 0, "qty": qty, "price": price,
                "purchase_no": purchase_no, "own_company": company,
                "note": "\n".join(t for t in [cell_text(get(row, "note"))] + extras if t),
                "planned_execution": cell_text(planned_raw)[:100],
            }
            for field, size in (("platform", 100), ("contract_no", 100), ("costs_note", 100),
                                ("investor", 150), ("payment_note", 100), ("delivery_place", 255),
                                ("phone", 255)):
                values[field] = cell_text(get(row, field))[:size]
            for field in ("comment", "delivery_terms"):
                values[field] = cell_text(get(row, field))
            if signed:
                values["signed_date"] = signed
            if deadline:
                values["deadline"] = deadline

            # Своя позиция узнаётся по закупке, предмету, количеству и цене:
            # у №000061174 две позиции одного костюма — на 80 и на 547 штук.
            # Записи, заведённые до реестра, количества не знают — их узнаём по сумме.
            base = Contract.objects.filter(title=values["title"], purchase_no=purchase_no)
            match = base.filter(qty=qty, price=price).first() if qty is not None else None
            if match is None:
                match = base.filter(qty__isnull=True, amount=values["amount"]).first()

            st_raw = cell_text(get(row, "status")).lower()
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
