"""Месяц административного расхода по комментарию.

В «Расход административные.xlsx» даты нет — месяц пишут словами
в комментарии: «хайр май окл», «аренда янв 26».
"""
import re
from collections import Counter
from datetime import date
from django.utils import timezone

_MONTHS = [(1, r"\bянв"), (2, r"\bфев"), (3, r"\bмарт"), (4, r"\bапр|\bарп"),
           (5, r"\bма[йя]\b"), (6, r"\bиюн"), (7, r"\bиюл"), (8, r"\bавг"),
           (9, r"\bсен"), (10, r"\bокт"), (11, r"\bноя"), (12, r"\bдек")]

# меньше одного упоминания месяца на столько строк — столбец месяцами не размечен
SPARSE_ROWS = 15

_FULL_YEAR = re.compile(r"(?<!\d)(20\d\d)(?!\d)")
_YEAR_AFTER_MONTH = re.compile(
    r"(?:янв|фев|март|апр|арп|ма[йя]|июн|июл|авг|сен|окт|ноя|дек)[а-я]*\.?\s*(\d\d)(?!\d)")


def month_in(comment):
    text = (comment or "").lower()
    for num, pattern in _MONTHS:
        if re.search(pattern, text):
            return num
    return None


def year_in(comment):
    """Год, если он написан: «аренда янв 26», «отчисл 2025»."""
    text = (comment or "").lower()
    m = _FULL_YEAR.search(text)
    if m:
        return int(m.group(1))
    m = _YEAR_AFTER_MONTH.search(text)
    return 2000 + int(m.group(1)) if m else None


def assign_months(comments, today=None):
    """Месяцы для столбца строк: из комментария, а где его нет — от строки выше.

    Каждый найденный месяц ставится туда, где он ближе всего к самому
    позднему уже встреченному: «дек → янв» — новый год, а «февр → дек» —
    запоздалая запись за прошлый месяц, а не прыжок на год.
    Год — по явному году в комментарии, иначе так, чтобы самый поздний
    месяц столбца не оказался в будущем.
    В столбце, где месяц почти не пишут, месяц получают только строки,
    где он написан: растянуть одно «июль» на весь столбец — значит выдумать.
    """
    today = today or timezone.localdate()
    found = [month_in(c) for c in comments]
    if not any(found):
        return [None] * len(comments)
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

    def as_date(i):
        return date(base + i // 12, i % 12 + 1, 1)

    if sum(i is not None for i in idx) * SPARSE_ROWS < len(idx):
        return [None if i is None else as_date(i) for i in idx]

    first = next(i for i in idx if i is not None)
    out, cur = [], None
    for i in idx:
        if i is not None:
            cur = i
        out.append(as_date(first if cur is None else cur))
    return out
