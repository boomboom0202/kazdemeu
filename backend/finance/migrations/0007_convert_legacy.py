"""Касса и постоянные расходы — в административные расходы.

* Расход из кассы без договора → административный расход: статья —
  его категория («Аренда», «Зарплата»), месяц — месяц операции.
* Поступление без договора → прочее поступление.
* Действующий постоянный расход → статья с планом в месяц: он и был
  планом, а факт теперь вносится строками статьи.
Касса по договорам перенесена в сами договоры миграцией contracts.0006.
"""
from django.db import migrations


def forwards(apps, schema_editor):
    CashEntry = apps.get_model("finance", "CashEntry")
    FixedCost = apps.get_model("finance", "FixedCost")
    AdminCategory = apps.get_model("finance", "AdminCategory")
    AdminExpense = apps.get_model("finance", "AdminExpense")
    OtherIncome = apps.get_model("finance", "OtherIncome")

    def category(name):
        cat = AdminCategory.objects.filter(name__iexact=name[:150]).first()
        if cat is None:
            cat = AdminCategory.objects.create(name=name[:150], position=AdminCategory.objects.count())
        return cat

    positions = {}
    for e in (CashEntry.objects.filter(contract__isnull=True).select_related("category")
              .order_by("date", "id")):
        desc = (e.description or "").strip()
        if e.direction == "out":
            cat = category(e.category.name if e.category_id else "Прочие расходы")
            positions[cat.id] = positions.get(cat.id, AdminExpense.objects.filter(category=cat).count()) + 1
            AdminExpense.objects.create(category=cat, amount=e.amount, comment=desc[:255],
                                        month=e.date.replace(day=1), source="manual",
                                        position=positions[cat.id])
        else:
            # «Оплата по графику» создавалась автоматически при отметке оплаты.
            # Без договора она остаётся, только если сам договор удалили, — это
            # не деньги предприятия, а след удалённого договора (на боевой базе —
            # тестовые «Test» и 17236026-1). В прочие поступления её не переносим.
            if desc.startswith("Оплата по графику"):
                continue
            label = desc or (e.category.name if e.category_id else "Поступление")
            OtherIncome.objects.create(date=e.date, amount=e.amount, comment=label[:255])

    for fc in FixedCost.objects.filter(is_active=True):
        cat = category(fc.name)
        cat.monthly_plan = (cat.monthly_plan or 0) + fc.monthly_amount
        cat.save(update_fields=["monthly_plan"])


class Migration(migrations.Migration):

    dependencies = [
        ("finance", "0006_admincategory_otherincome_adminexpense"),
        ("contracts", "0006_convert_money"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
