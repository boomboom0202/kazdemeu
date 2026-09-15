"""Размеры, уже записанные в заказы и на склад, — одним написанием.

«54-188» становится «54/188», «60/62-182/188» — «60-62/182-188». Размер,
который по сетке не проходит («48/192»), не трогаем: записи по нему уже
есть, а поправить его человек сможет сам. Если приведённый размер уже есть
в заказе, строка тоже остаётся как была — сливать сетку молча нельзя.
Строки сетки выстраиваются по порядку: размер, внутри — рост.
"""
from django.db import migrations


def forwards(apps, schema_editor):
    from workshop.sizes import normalize_size, size_sort_key

    WorkSize = apps.get_model("workshop", "WorkSize")
    Goods = apps.get_model("warehouse", "GoodsMovement")

    by_order = {}
    for s in WorkSize.objects.all().order_by("order_id", "position", "id"):
        by_order.setdefault(s.order_id, []).append(s)
    for sizes in by_order.values():
        taken = {s.size for s in sizes}
        for s in sizes:
            canon, err = normalize_size(s.size)
            if err or canon == s.size or canon in taken:
                continue
            taken.discard(s.size)
            taken.add(canon)
            s.size = canon
            s.save(update_fields=["size"])
        for pos, s in enumerate(sorted(sizes, key=lambda x: size_sort_key(x.size))):
            if s.position != pos:
                s.position = pos
                s.save(update_fields=["position"])

    for g in Goods.objects.exclude(size=""):
        canon, err = normalize_size(g.size)
        if not err and canon != g.size:
            g.size = canon
            g.save(update_fields=["size"])


class Migration(migrations.Migration):

    dependencies = [
        ("workshop", "0004_remove_cutmaterial_cut_and_more"),
        ("warehouse", "0007_remove_purchaseorder_material_and_more"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
