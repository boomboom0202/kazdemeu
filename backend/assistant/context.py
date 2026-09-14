"""Срез базы для AI-ассистента: тендеры, договоры с деньгами, цех, склад, финансы.

Ассистент отвечает тем, кто его спросил, поэтому в срез попадают только
разделы, открытые этому человеку.
"""
import json
from django.utils import timezone


def _f(v):
    return round(float(v or 0), 2)


def build_db_context(user=None, max_items=60):
    from accounts.permissions import can_read

    def allowed(key):
        return user is None or can_read(user, key)

    out = {"today": str(timezone.localdate())}

    if allowed("tenders.tenders"):
        from tenders.models import Tender
        out["tenders"] = [{
            "purchase_no": t.purchase_no, "customer": t.customer_name, "item": t.item_name,
            "qty": t.qty, "customer_price": _f(t.price), "our_price": _f(t.plan_price),
            "cost_per_unit": _f(t.cost_per_unit), "status": t.get_status_display(),
            "deadline": str(t.deadline or ""),
        } for t in Tender.objects.all()[:max_items]]

    if allowed("contracts.contracts"):
        from contracts.models import Contract
        see_money = allowed("contracts.payments") and allowed("contracts.expenses")
        rows = []
        for c in (Contract.objects.select_related("customer", "own_company")
                  .prefetch_related("payments", "expenses")[:max_items]):
            row = {"purchase_no": c.purchase_no or c.number, "customer": c.customer.name,
                   "title": c.title, "qty": _f(c.qty), "price": _f(c.price), "amount": _f(c.amount),
                   "status": c.get_status_display(), "deadline": str(c.deadline or ""),
                   "firm": c.own_company.name if c.own_company else ""}
            if see_money:
                row.update({"paid": _f(c.paid_amount), "expenses": _f(c.expenses_total),
                            "profit": _f(c.profit),
                            "expense_lines": [f"{_f(e.amount)} {e.comment}" for e in c.expenses.all()][:40]})
            rows.append(row)
        out["contracts"] = rows

    if allowed("workshop.orders"):
        from workshop.models import WorkOrder
        from workshop.calc import with_details, order_summary
        out["workshop_orders"] = [{
            "product": o.product, "contract": (o.contract.purchase_no or o.contract.number) if o.contract else "",
            "status": o.get_status_display(), "deadline": str(o.deadline or ""),
            **{k: v for k, v in order_summary(o).items() if k != "stages"},
            "stages": {s["name"]: {"done": s["done"], "in_work": s["in_work"]} for s in order_summary(o)["stages"]},
        } for o in with_details(WorkOrder.objects.all())[:max_items]]

    if allowed("warehouse.materials"):
        from warehouse.models import Material
        out["materials"] = [{"name": m.name, "stock": _f(m.stock), "unit": m.unit,
                             "min_stock": _f(m.min_stock), "avg_price": _f(m.avg_price)}
                            for m in Material.objects.all()[:max_items]]

    if allowed("finance.reports"):
        from finance.views import build_summary
        s = build_summary()
        out["finance"] = {k: s[k] for k in ("paid", "debt", "contract_expenses", "admin_expenses",
                                            "other_income", "cash", "expected_result", "months", "kinds")}

    return json.dumps(out, ensure_ascii=False, default=str)
