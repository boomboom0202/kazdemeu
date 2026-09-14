"""Деньги договора переезжают в сам договор.

* Номер закупки — из номера договора: реестр узнаёт заведённые раньше записи.
* График платежей → оплаты: оплаченная часть каждой строки становится
  оплатой; неоплаченный остаток записывается в «Коментарий» договора,
  чтобы план не потерялся.
* Касса по договору → оплаты (поступления) и расходы (расходы договора).
  Поступления «Оплата по графику» создавались автоматически при отметке
  оплаты в графике — это дубли уже перенесённых оплат, их пропускаем.
"""
from django.db import migrations
from django.db.models import F, Max

CARRY_OVER_NOTE = "Перенос из прежнего учёта"
AUTO_CASH = "Оплата по графику"


def _sp(v):
    return f"{v:,.0f}".replace(",", " ")


def forwards(apps, schema_editor):
    from contracts.excel import classify

    Contract = apps.get_model("contracts", "Contract")
    Schedule = apps.get_model("contracts", "PaymentScheduleItem")
    Payment = apps.get_model("contracts", "ContractPayment")
    Expense = apps.get_model("contracts", "ContractExpense")
    CashEntry = apps.get_model("finance", "CashEntry")

    Contract.objects.filter(purchase_no="").update(purchase_no=F("number"))

    plans = {}
    for item in Schedule.objects.all().order_by("due_date", "id"):
        paid = item.paid_amount or 0
        if paid > 0:
            Payment.objects.create(
                contract_id=item.contract_id, date=item.paid_date or item.due_date,
                amount=min(paid, item.amount) if item.note == CARRY_OVER_NOTE else paid,
                comment=(item.note or AUTO_CASH)[:255], source="manual")
        rest = item.amount - paid
        if rest > 0:
            plans.setdefault(item.contract_id, []).append(
                f"{_sp(rest)} ₸ до {item.due_date:%d.%m.%Y}" + (f" ({item.note})" if item.note else ""))
    for cid, lines in plans.items():
        c = Contract.objects.get(pk=cid)
        text = "План оплат из прежнего графика: " + "; ".join(lines)
        c.note = f"{c.note}\n{text}" if c.note else text
        c.save(update_fields=["note"])

    paid_by_schedule = set(Schedule.objects.filter(paid_amount__gt=0)
                           .values_list("contract_id", flat=True))
    positions = {}
    for e in (CashEntry.objects.filter(contract__isnull=False).select_related("category")
              .order_by("date", "id")):
        desc = (e.description or "").strip()
        if e.direction == "in":
            if desc.startswith(AUTO_CASH) and e.contract_id in paid_by_schedule:
                continue
            Payment.objects.create(contract_id=e.contract_id, date=e.date, amount=e.amount,
                                   comment=(desc or "Поступление")[:255], source="manual")
        else:
            cat = e.category.name if e.category_id else ""
            comment = " · ".join(x for x in (cat, desc) if x)[:255]
            if e.contract_id not in positions:
                positions[e.contract_id] = (Expense.objects.filter(contract_id=e.contract_id)
                                            .aggregate(m=Max("position"))["m"] or 0)
            positions[e.contract_id] += 1
            Expense.objects.create(contract_id=e.contract_id, date=e.date, amount=e.amount,
                                   comment=comment, kind=classify(comment), source="manual",
                                   position=positions[e.contract_id])


class Migration(migrations.Migration):

    dependencies = [
        ("contracts", "0005_contract_comment_contract_contract_no_and_more"),
        ("finance", "0005_alter_expensecategory_options"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
