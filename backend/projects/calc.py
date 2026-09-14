"""Расчёты и разбор Excel для проектов и административных расходов."""
import re
from collections import Counter
from datetime import date
from decimal import Decimal, InvalidOperation
from django.utils import timezone

ZERO = Decimal("0")


def money(value):
    """Сумма из ячейки: «2 940,00», «1 440 000,00₸», 750 — всё в Decimal.
    Непонятное — None, чтобы строку можно было отметить, а не записать ноль."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float, Decimal)):
        return Decimal(str(value))
    text = (str(value).replace("\xa0", "").replace(" ", "").replace("₸", "")
            .replace("тг", "").replace(",", "."))
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def f(v):
    return float(round(v, 2))


# ── Вид траты по комментарию ────────────────────────────────────────────
# В таблице у траты только сумма и пара слов. Чтобы увидеть, куда уходят
# деньги, вид определяется по этим словам; его всегда можно поправить.
# Порядок важен: «дост образец» — это доставка, «берцы 50%» — закуп.
_RULES = [
    ("legal", ["пеня", "пени", "суд", "пошл", "юрист", "нотар", "гарант", "экспертиз", "штамп",
               "справк", "реестр"]),
    ("travel", ["гостиниц", "билет", "поезд", "еда ", "еда", "командир", "продукты"]),
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


# ── Месяц из комментария ────────────────────────────────────────────────
_MONTHS = [(1, r"\bянв"), (2, r"\bфев"), (3, r"\bмарт"), (4, r"\bапр|\bарп"),
           (5, r"\bма[йя]\b"), (6, r"\bиюн"), (7, r"\bиюл"), (8, r"\bавг"),
           (9, r"\bсен"), (10, r"\bокт"), (11, r"\bноя"), (12, r"\bдек")]


def month_in(comment):
    text = (comment or "").lower()
    for num, pattern in _MONTHS:
        if re.search(pattern, text):
            return num
    return None


_FULL_YEAR = re.compile(r"(?<!\d)(20\d\d)(?!\d)")
_YEAR_AFTER_MONTH = re.compile(
    r"(?:янв|фев|март|апр|арп|ма[йя]|июн|июл|авг|сен|окт|ноя|дек)[а-я]*\.?\s*(\d\d)(?!\d)")


def year_in(comment):
    """Год, если он написан: «аренда янв 26», «отчисл 2025»."""
    text = (comment or "").lower()
    m = _FULL_YEAR.search(text)
    if m:
        return int(m.group(1))
    m = _YEAR_AFTER_MONTH.search(text)
    return 2000 + int(m.group(1)) if m else None


def assign_months(comments, today=None):
    """Месяцы для столбца строк: из комментария, а где его нет — от соседей.

    Строки в листе идут по порядку, поэтому «оф мен» между «хайр февр»
    и «техн февр» — это февраль.

    Каждый найденный месяц ставится туда, где он ближе всего к самому
    позднему уже встреченному: «дек → янв» — новый год, а «февр → янв»
    или «февр → дек» — запоздалая запись за прошлый месяц. Раньше любой
    откат назад считался переходом через Новый год, и одна поздняя строка
    «аренд дек» уводила весь столбец аренды на год, а то и два, в прошлое.

    Год — по явному году в комментарии («аренда янв 26»), а если его нигде
    нет — так, чтобы самый поздний месяц столбца не оказался в будущем.
    """
    today = today or timezone.localdate()
    found = [month_in(c) for c in comments]
    if not any(found):
        return [None] * len(comments)
    # месяц на общей шкале: год * 12 + (месяц − 1), год — от начала столбца
    idx, top = [], None
    for m in found:
        if m is None:
            idx.append(None)
            continue
        if top is None:
            i = m - 1
        else:
            y = top // 12
            i = min(((y + d) * 12 + m - 1 for d in (-1, 0, 1)), key=lambda v: (abs(v - top), -v))
        idx.append(i)
        top = i if top is None else max(top, i)

    votes = Counter()
    for c, i in zip(comments, idx):
        y = year_in(c) if i is not None else None
        if y and today.year - 5 <= y <= today.year + 1:
            votes[y - i // 12] += 1
    if votes:
        base = votes.most_common(1)[0][0]
    else:
        base = (today.year if top % 12 + 1 <= today.month else today.year - 1) - top // 12

    # пропуски: вперёд от предыдущего, в начале столбца — от первого найденного
    first = next(i for i in idx if i is not None)
    out, cur = [], None
    for i in idx:
        if i is not None:
            cur = i
        pick = first if cur is None else cur
        out.append(date(base + pick // 12, pick % 12 + 1, 1))
    return out


# ── Лист «колонками»: заголовок в первой строке, под ним сумма и комментарий ─
TOTAL_WORDS = ("расход", "расходы", "итого", "итог", "остаток")


def read_blocks(ws):
    """[(название, [(номер строки, сумма|None, комментарий), ...]), ...]

    Каждый блок — две колонки: сумма и комментарий, заголовок над суммой
    (в файле он объединён на обе колонки)."""
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


def project_stats(p):
    expenses = sum((e.amount for e in p.expenses.all()), ZERO)
    income = sum((i.amount for i in p.incomes.all()), ZERO)
    contracts = list(p.contracts.all())
    contracts_amount = sum((c.amount for c in contracts), ZERO)
    balance = income - expenses
    expected = contracts_amount - expenses
    return {
        "contracts_count": len(contracts),
        "contracts_amount": f(contracts_amount),
        "income": f(income),
        "expenses": f(expenses),
        "balance": f(balance),                 # остаток, как внизу колонки в «Расходах»
        "expected_profit": f(expected),        # что останется, когда заплатят по всем договорам
        "margin": round(float(expected / contracts_amount * 100), 1) if contracts_amount else None,
        "minus": balance < 0,                  # «минусовой»: потратили больше, чем пришло
    }
