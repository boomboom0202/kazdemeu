"""Сбор среза базы данных для контекста AI-ассистента."""
import json
from django.db.models import Sum
from django.utils import timezone


def build_db_context(max_items=40):
    from contracts.models import Contract
    from production.models import Product
    from warehouse.models import Material
    from finance.models import CashEntry

    contracts = [{
        "number": c.number, "customer": c.customer.name, "title": c.title,
        "status": c.get_status_display(), "amount": float(c.amount),
        "paid": float(c.paid_amount), "deadline": str(c.deadline or ""),
        "spec": (c.specification or "")[:200],
    } for c in Contract.objects.select_related("customer")[:max_items]]

    products = [{
        "name": p.name, "sku": p.sku, "price": float(p.base_price),
        "cost_price": round(float(p.cost_price), 2),
        "margin_percent": round(p.margin_percent, 1),
        "fg_stock": p.fg_stock,
        "bom": [{"material": i.material.name, "qty": float(i.qty), "unit": i.material.unit}
                for i in p.bom_items.select_related("material")],
    } for p in Product.objects.all()[:max_items]]

    materials = [{
        "name": m.name, "sku": m.sku, "stock": float(m.stock), "unit": m.unit,
        "min_stock": float(m.min_stock), "avg_price": round(float(m.avg_price), 2),
    } for m in Material.objects.all()[:max_items]]

    income = CashEntry.objects.filter(direction="in").aggregate(s=Sum("amount"))["s"] or 0
    expense = CashEntry.objects.filter(direction="out").aggregate(s=Sum("amount"))["s"] or 0

    return json.dumps({
        "today": str(timezone.localdate()),
        "contracts": contracts,
        "products": products,
        "materials": materials,
        "finance": {"total_income": float(income), "total_expense": float(expense),
                    "cash_balance": float(income - expense)},
    }, ensure_ascii=False)
