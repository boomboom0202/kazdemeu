"""Остаток готовой продукции.

Выпуск цеха — это то, что прошло последний этап заказа: отдельной записи
«сдали на склад» нет, склад видит выпуск сам. К нему прибавляется
внесённое руками (остаток при переходе на систему) и вычитается отгрузка.
Строка остатка — заказ цеха и размер; внесённое без заказа — изделие и размер.
"""
from collections import OrderedDict


def _key(order_id, product, size):
    return (order_id, (product or "").strip().lower(), (size or "").strip())


def goods_lines():
    from workshop.models import WorkOrder
    from workshop.calc import with_details, size_summary
    from .models import GoodsMovement

    lines = OrderedDict()
    orders = with_details(WorkOrder.objects.select_related("contract__customer"))
    for o in orders:
        stages = list(o.stages.all())
        c = o.contract
        for s in o.sizes.all():
            lines[_key(o.id, o.product, s.size)] = {
                "order": o.id, "order_status": o.status, "product": o.product, "size": s.size,
                "contract": c.id if c else None,
                "contract_number": (c.purchase_no or c.number) if c else None,
                "customer": c.customer.name if c else o.client,
                "planned": s.planned, "made": size_summary(s, stages)["finished"],
                "received": 0, "shipped": 0,
            }
    for m in GoodsMovement.objects.select_related("contract__customer"):
        k = _key(m.work_order_id, m.product, m.size)
        line = lines.get(k)
        if line is None:
            c = m.contract
            line = lines[k] = {
                "order": m.work_order_id, "order_status": None, "product": m.product, "size": m.size,
                "contract": c.id if c else None,
                "contract_number": (c.purchase_no or c.number) if c else None,
                "customer": c.customer.name if c else "",
                "planned": None, "made": 0, "received": 0, "shipped": 0,
            }
        line["received" if m.kind == GoodsMovement.Kind.IN else "shipped"] += m.qty
    out = []
    for line in lines.values():
        line["stock"] = line["made"] + line["received"] - line["shipped"]
        if line["made"] or line["received"] or line["shipped"]:
            out.append(line)
    return out


def line_stock(work_order, product, size):
    k = _key(work_order.id if work_order else None, product, size)
    for line in goods_lines():
        if _key(line["order"], line["product"], line["size"]) == k:
            return line["stock"]
    return 0
