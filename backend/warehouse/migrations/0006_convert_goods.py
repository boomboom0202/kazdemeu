"""Готовая продукция без каталога изделий.

Движения готовой продукции ссылались на изделие каталога — каталог убран.
Каждое движение становится записью склада с названием изделия: плюс —
приход (сдача из цеха, внесённый остаток), минус — отгрузка.
Заявки на закуп (авто-заявки при низком остатке) не переносятся: низкий
остаток по-прежнему приходит уведомлением.
"""
from django.db import migrations


def forwards(apps, schema_editor):
    FG = apps.get_model("warehouse", "FinishedGoodsMovement")
    Goods = apps.get_model("warehouse", "GoodsMovement")
    for m in FG.objects.select_related("product").order_by("created_at", "id"):
        if not m.qty:
            continue
        Goods.objects.create(
            kind="in" if m.qty > 0 else "out", date=m.created_at.date(),
            product=m.product.name[:150], qty=abs(m.qty), contract_id=m.contract_id,
            note=(m.note or "")[:255])


class Migration(migrations.Migration):

    dependencies = [
        ("warehouse", "0005_stockmovement_work_order_alter_material_min_stock_and_more"),
        ("production", "0007_alter_bomitem_options_alter_pricelist_options_and_more"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
