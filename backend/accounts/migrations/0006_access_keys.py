"""Точечные права — на новые разделы.

Разделы «Изделия и каталог» и «Производство» стали частью цеха, график
платежей — оплатами договора, касса и постоянные расходы — административными
расходами. Правило на убранную часть переходит на ту, что её заменила;
если у человека уже есть правило на неё, остаётся более широкое из двух.
Правила на части, которым замены нет (прайс-листы, настройки себестоимости,
заявки на закуп), удаляются.
"""
from django.db import migrations

MAP = {
    "catalog": "workshop", "production": "workshop",
    "catalog.stages": "workshop.stages", "catalog.routes": "workshop.stages",
    "production.orders": "workshop.orders", "production.stages": "workshop.entries",
    "workshop.cutting": "workshop.entries", "workshop.sewing": "workshop.entries",
    "workshop.packing": "workshop.entries",
    "contracts.schedule": "contracts.payments",
    "warehouse.batches": "warehouse.receipts", "warehouse.movements": "warehouse.issues",
    "warehouse.fg": "warehouse.goods",
    "finance.entries": "finance.admin", "finance.fixed": "finance.admin",
}

# Ключи на момент этой миграции (список в accounts.permissions может потом меняться)
VALID = {
    "tenders", "contracts", "workshop", "warehouse", "finance", "analytics",
    "tenders.tenders", "tenders.platforms", "tenders.companies",
    "contracts.contracts", "contracts.customers", "contracts.payments", "contracts.expenses",
    "contracts.files", "contracts.comments",
    "workshop.orders", "workshop.entries", "workshop.brigades", "workshop.stages",
    "warehouse.materials", "warehouse.receipts", "warehouse.issues", "warehouse.goods",
    "warehouse.suppliers",
    "finance.reports", "finance.admin", "finance.income",
}
RANK = {"none": 0, "read": 1, "write": 2}


def forwards(apps, schema_editor):
    UserAccess = apps.get_model("accounts", "UserAccess")
    for rule in list(UserAccess.objects.all().order_by("id")):
        old = rule.key
        key = MAP.get(old, old)
        if key not in VALID:
            rule.delete()
            continue
        if key == old:
            continue
        other = UserAccess.objects.filter(user_id=rule.user_id, key=key).exclude(pk=rule.pk).first()
        if other:
            if RANK.get(rule.level, 0) > RANK.get(other.level, 0):
                other.level = rule.level
                other.save(update_fields=["level"])
            rule.delete()
        else:
            rule.key = key
            rule.note = (f"{rule.note} (было: {old})" if rule.note else f"было: {old}")[:255]
            rule.save(update_fields=["key", "note"])


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0005_alter_user_role"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
