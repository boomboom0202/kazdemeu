"""Цех переходит на настраиваемые этапы.

* Заводятся стандартные этапы: Крой, Вышивка, Тигин, Чистка, Упаковка.
* Заказы, начатые до перехода, получают те этапы, которые у них были:
  Крой, Вышивка, Тигин, Упаковка. Чистку им не добавляем — иначе упаковка
  по уже идущим заказам упёрлась бы в пустой этап.
* Записи кроя (с метражом), вышивки и упаковки становятся записями этапов,
  партии бригад привязываются к этапу «Тигин».
* Производственные заказы из убранного раздела «Изделия и нормы» становятся
  заказами цеха: изделие, договор и количество одной строкой «без размера».
  Отменённые не переносятся. Готовая продукция по ним уже лежит на складе
  (её перенесёт warehouse.0006), поэтому записи этапов не выдумываются.
"""
from django.db import migrations

STAGES = [
    ("Крой", "cut", "", True),
    ("Вышивка", "count", "Вид", True),
    ("Тигин", "sewing", "", True),
    ("Чистка", "count", "", True),
    ("Упаковка", "count", "", True),
]
LEGACY_ROUTE = ("Крой", "Вышивка", "Тигин", "Упаковка")


def forwards(apps, schema_editor):
    T = apps.get_model("workshop", "StageTemplate")
    OrderStage = apps.get_model("workshop", "WorkOrderStage")
    WorkOrder = apps.get_model("workshop", "WorkOrder")
    WorkSize = apps.get_model("workshop", "WorkSize")
    StageEntry = apps.get_model("workshop", "StageEntry")
    EntryMaterial = apps.get_model("workshop", "EntryMaterial")
    CutEntry = apps.get_model("workshop", "CutEntry")
    EmbroideryEntry = apps.get_model("workshop", "EmbroideryEntry")
    PackEntry = apps.get_model("workshop", "PackEntry")
    SewingJob = apps.get_model("workshop", "SewingJob")
    ProductionOrder = apps.get_model("production", "ProductionOrder")

    tpl = {}
    for pos, (name, kind, extra, active) in enumerate(STAGES):
        t = T.objects.filter(name=name).first()
        if t is None:
            t = T.objects.create(name=name, kind=kind, extra_label=extra, position=pos, is_active=active)
        tpl[name] = t

    def route(order):
        return {name: OrderStage.objects.get_or_create(order=order, template=tpl[name])[0]
                for name in LEGACY_ROUTE}

    routes = {o.id: route(o) for o in WorkOrder.objects.all()}

    def copy_entry(old, stage_name, extra=""):
        e = StageEntry.objects.create(stage=routes[old.size.order_id][stage_name], size_id=old.size_id,
                                      date=old.date, qty=old.qty, extra=extra[:60], note=old.note)
        StageEntry.objects.filter(pk=e.pk).update(created_at=old.created_at)
        return e

    for c in CutEntry.objects.select_related("size").prefetch_related("materials").order_by("id"):
        e = copy_entry(c, "Крой")
        for m in c.materials.all():
            EntryMaterial.objects.create(entry=e, material=m.material, meters=m.meters)
    for x in EmbroideryEntry.objects.select_related("size").order_by("id"):
        copy_entry(x, "Вышивка", x.kind)
    for x in PackEntry.objects.select_related("size").order_by("id"):
        copy_entry(x, "Упаковка")
    for j in SewingJob.objects.select_related("size"):
        j.stage = routes[j.size.order_id]["Тигин"]
        j.save(update_fields=["stage"])

    for po in (ProductionOrder.objects.select_related("product", "contract__customer")
               .exclude(status="cancelled").order_by("id")):
        o = WorkOrder.objects.create(
            product=po.product.name[:150], contract_id=po.contract_id,
            client=po.contract.customer.name[:200] if po.contract_id else "",
            status="done" if po.status == "done" else "in_work",
            note=f"Перенесено из производственного заказа №{po.number}.")
        WorkSize.objects.create(order=o, size="без размера", planned=max(po.qty, 1), position=0)
        route(o)


class Migration(migrations.Migration):

    dependencies = [
        ("workshop", "0002_stagetemplate_alter_sewingjob_size_and_more"),
        ("production", "0007_alter_bomitem_options_alter_pricelist_options_and_more"),
        ("contracts", "0005_contract_comment_contract_contract_no_and_more"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
