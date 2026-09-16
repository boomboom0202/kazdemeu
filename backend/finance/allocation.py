"""Разнесение административных расходов по договорам.

Оклады, аренда и налоги не относятся к одному договору, но заработок
считается с их учётом. Поэтому расходы месяца делятся между договорами,
которые в этом месяце были в работе, пропорционально сумме договора:
крупный договор берёт большую часть.

Договор считается в работе в месяце, если месяц попадает в промежуток
от подписания (или первых денег по договору) до срока поставки (или
последних денег). Отменённые договоры в разнесении не участвуют.
Административные расходы без месяца делятся по всем договорам.
"""
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal, ROUND_HALF_UP

ZERO = Decimal("0")
MAX_MONTHS = 60          # страховка от договора с опечаткой в дате


def month_start(d):
    return d.replace(day=1)


def next_month(d):
    return (d + timedelta(days=32)).replace(day=1)


def contract_months(contract):
    """Месяцы, в которых договор был в работе."""
    money = [x.date for x in list(contract.payments.all()) + list(contract.expenses.all()) if x.date]
    starts = [d for d in [contract.signed_date, *money] if d]
    ends = [d for d in [contract.deadline, *money] if d]
    if not starts or not ends:
        return []
    m, last = month_start(min(starts)), month_start(max(ends))
    out = []
    while m <= last and len(out) < MAX_MONTHS:
        out.append(m)
        m = next_month(m)
    return out


def admin_shares(contracts=None):
    """{id договора: доля административных расходов, ₸}."""
    from contracts.models import Contract
    from .models import AdminExpense

    if contracts is None:
        contracts = list(Contract.objects.exclude(status=Contract.Status.CANCELLED)
                         .prefetch_related("payments", "expenses"))
    else:
        contracts = [c for c in contracts if c.status != Contract.Status.CANCELLED]
    if not contracts:
        return {}

    by_month, no_month = defaultdict(lambda: ZERO), ZERO
    for e in AdminExpense.objects.all():
        if e.month:
            by_month[month_start(e.month)] += e.amount
        else:
            no_month += e.amount
    if not by_month and not no_month:
        return {}

    active = defaultdict(list)
    for c in contracts:
        for m in contract_months(c):
            active[m].append(c)

    shares = defaultdict(lambda: ZERO)

    def spread(total, rows):
        base = sum(c.amount for c in rows)
        if not base:
            return
        for c in rows:
            shares[c.id] += total * c.amount / base

    for m, total in by_month.items():
        # месяц, в котором ни один договор не шёл, делится по всем: деньги потрачены всё равно
        spread(total, active.get(m) or contracts)
    if no_month:
        spread(no_month, contracts)

    return {cid: v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) for cid, v in shares.items()}
