"""Аналитика: вся цепочка на одной странице — тендеры → договоры → цех → деньги.

Каждый блок отдаётся только тем, кому открыт его раздел: технолог увидит
цех, но не увидит денег; бухгалтер — деньги и договоры.
"""
from collections import OrderedDict
from datetime import timedelta
from decimal import Decimal
from django.db.models import Sum
from django.db.models.functions import TruncWeek
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from accounts.permissions import section_read, can_read


def _f(v):
    return float(round(Decimal(v or 0), 2))


@api_view(["GET"])
@permission_classes([section_read("analytics")])
def overview(request):
    user = request.user
    today = timezone.localdate()
    data = {"today": today}

    if can_read(user, "tenders.tenders"):
        from tenders.models import Tender
        stages = OrderedDict((k, {"status": k, "label": label, "count": 0, "amount": 0.0})
                             for k, label in Tender.Status.choices)
        for t in Tender.objects.all():
            row = stages[t.status]
            row["count"] += 1
            row["amount"] += float(t.plan_total or t.customer_total)
        won, lost = stages["won"]["count"], stages["lost"]["count"] + stages["rejected"]["count"]
        data["tenders"] = {
            "stages": list(stages.values()),
            "total": sum(s["count"] for s in stages.values()),
            "win_rate": round(won / (won + lost) * 100, 1) if won + lost else None,
            "urgent": Tender.objects.filter(status__in=["planned", "submitted"],
                                            deadline__gte=today,
                                            deadline__lte=today + timedelta(days=3)).count(),
        }

    if can_read(user, "contracts.contracts"):
        from contracts.models import Contract
        see_money = can_read(user, "contracts.payments") and can_read(user, "contracts.expenses")
        contracts = list(Contract.objects.select_related("customer", "own_company")
                         .prefetch_related("payments", "expenses"))
        by_status = OrderedDict((k, {"status": k, "label": label, "count": 0, "amount": 0.0})
                                for k, label in Contract.Status.choices)
        customers, overdue, rows = {}, [], []
        for c in contracts:
            by_status[c.status]["count"] += 1
            by_status[c.status]["amount"] += float(c.amount)
            if c.status != "cancelled":
                customers[c.customer.name] = customers.get(c.customer.name, 0.0) + float(c.amount)
            if c.is_overdue:
                overdue.append({"id": c.id, "number": c.purchase_no or c.number, "title": c.title,
                                "customer": c.customer.name, "deadline": c.deadline,
                                "days": (today - c.deadline).days})
            if see_money and c.status != "cancelled":
                spent, paid = c.expenses_total, c.paid_amount
                rows.append({"id": c.id, "number": c.purchase_no or c.number, "title": c.title,
                             "customer": c.customer.name, "amount": _f(c.amount), "paid": _f(paid),
                             "expenses": _f(spent), "profit": _f(c.amount - spent),
                             "margin": round(float((c.amount - spent) / c.amount * 100), 1) if c.amount else None})
        block = {
            "by_status": list(by_status.values()),
            "overdue": sorted(overdue, key=lambda r: -r["days"]),
            "top_customers": [{"customer": k, "amount": round(v, 2)}
                              for k, v in sorted(customers.items(), key=lambda kv: -kv[1])[:8]],
        }
        if see_money:
            with_costs = [r for r in rows if r["expenses"]]
            block["best"] = sorted(with_costs, key=lambda r: -r["profit"])[:5]
            block["worst"] = sorted(with_costs, key=lambda r: r["profit"])[:5]
        data["contracts"] = block

    if can_read(user, "finance.reports"):
        from finance.views import build_summary
        s = build_summary()
        data["money"] = {k: s[k] for k in ("contracts_amount", "paid", "debt", "contract_expenses",
                                           "admin_expenses", "other_income", "cash",
                                           "expected_result", "months", "kinds")}

    if can_read(user, "workshop.orders"):
        from workshop.models import WorkOrder, StageEntry, StageTemplate
        from workshop.calc import with_details, order_summary, job_sewn
        orders = list(with_details(WorkOrder.objects.filter(status=WorkOrder.Status.IN_WORK)))
        planned = finished = 0
        per_stage = OrderedDict((t.id, {"name": t.name, "done": 0, "in_work": 0})
                                for t in StageTemplate.objects.all())
        late = []
        for o in orders:
            sm = order_summary(o)
            planned += sm["planned"]
            finished += sm["finished"]
            for st in sm["stages"]:
                per_stage[st["template"]]["done"] += st["done"]
                per_stage[st["template"]]["in_work"] += st["in_work"]
            if o.deadline and o.deadline < today:
                late.append({"id": o.id, "product": o.product, "deadline": o.deadline,
                             "left": sm["left"], "days": (today - o.deadline).days})
        since = today - timedelta(weeks=8)
        weekly = OrderedDict()
        rows = (StageEntry.objects.filter(date__gte=since)
                .annotate(w=TruncWeek("date")).values("w", "stage__template__name")
                .annotate(q=Sum("qty")).order_by("w"))
        for r in rows:
            key = r["w"].isoformat()
            weekly.setdefault(key, {"week": key})[r["stage__template__name"]] = r["q"]
        crews = {}
        from workshop.models import SewingJob
        from workshop.serializers import who
        for j in SewingJob.objects.select_related("responsible").prefetch_related("progress"):
            label = who(j) or "не указан"
            b = crews.setdefault(label, {"who": label, "sewn": 0, "in_work": 0})
            s = job_sewn(j)
            b["sewn"] += s
            b["in_work"] += j.qty - s
        data["workshop"] = {
            "orders": len(orders), "planned": planned, "finished": finished,
            "left": max(planned - finished, 0),
            "stages": [s for s in per_stage.values() if s["done"] or s["in_work"]],
            "late": sorted(late, key=lambda r: -r["days"]),
            "weekly": list(weekly.values()),
            "crews": sorted(crews.values(), key=lambda b: -b["sewn"])[:10],
        }

    if can_read(user, "warehouse.materials"):
        from warehouse.models import Material
        low = [{"id": m.id, "name": m.name, "stock": _f(m.stock), "min": _f(m.min_stock), "unit": m.unit}
               for m in Material.objects.filter(min_stock__gt=0) if m.stock < m.min_stock]
        data["warehouse"] = {"low_stock": low}

    return Response(data)
