"""Аналитика: рейтинг ликвидности, маржа, динамика, статусы договоров, KPI-дашборд."""
from decimal import Decimal
from collections import defaultdict
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from accounts.permissions import section_read
from rest_framework.response import Response
from django.db.models import Sum, Count, F, Value, DecimalField
from django.db.models.functions import TruncMonth, Coalesce
from django.utils import timezone


@api_view(["GET"])
@permission_classes([section_read("analytics")])
def product_analytics(request):
    """Рейтинг ликвидности: продажи (отгрузки) за период + себестоимость/маржа."""
    from production.models import Product
    from warehouse.models import FinishedGoodsMovement
    sold = (FinishedGoodsMovement.objects.filter(qty__lt=0)
            .values("product").annotate(sold=Sum("qty")))
    sold_map = {r["product"]: -r["sold"] for r in sold}
    produced = (FinishedGoodsMovement.objects.filter(qty__gt=0)
                .values("product").annotate(made=Sum("qty")))
    made_map = {r["product"]: r["made"] for r in produced}
    rows = []
    for p in Product.objects.all():
        qty_sold = sold_map.get(p.id, 0)
        cost = float(p.cost_price)
        margin = float(p.margin)
        stock = p.fg_stock
        rows.append({
            "id": p.id, "name": p.name, "sku": p.sku,
            "sold_qty": qty_sold, "produced_qty": made_map.get(p.id, 0),
            "fg_stock": stock,
            "base_price": float(p.base_price),
            "cost_price": round(cost, 2),
            "material_cost": round(float(p.material_cost), 2),
            "labor_cost": float(p.labor_cost),
            "norm_hours": float(p.norm_hours or 0),
            "overhead_override": p.overhead_override,
            "overhead_cost": round(float(p.overhead), 2),
            "margin": round(margin, 2),
            "margin_percent": round(p.margin_percent, 1),
            "net_profit_est": round(margin * qty_sold, 2),
            # на какую сумму лежит готовая продукция на складе
            "stock_value_cost": round(cost * stock, 2),
            "stock_value_price": round(float(p.base_price) * stock, 2),
        })
    rows.sort(key=lambda r: r["sold_qty"], reverse=True)
    return Response(rows)


@api_view(["GET"])
@permission_classes([section_read("analytics")])
def stock_value(request):
    """Стоимость остатков готовой продукции на складе: по себестоимости и по цене продажи."""
    from production.models import Product
    items, total_cost, total_price, total_qty = [], 0.0, 0.0, 0
    for p in Product.objects.all():
        stock = p.fg_stock
        if not stock:
            continue
        c = float(p.cost_price) * stock
        s = float(p.base_price) * stock
        total_cost += c
        total_price += s
        total_qty += stock
        items.append({"id": p.id, "name": p.name, "sku": p.sku, "qty": stock,
                      "cost_price": round(float(p.cost_price), 2),
                      "base_price": float(p.base_price),
                      "value_cost": round(c, 2), "value_price": round(s, 2)})
    items.sort(key=lambda r: r["value_cost"], reverse=True)
    return Response({
        "items": items,
        "total_qty": total_qty,
        "total_value_cost": round(total_cost, 2),
        "total_value_price": round(total_price, 2),
        "potential_margin": round(total_price - total_cost, 2),
    })


@api_view(["GET"])
@permission_classes([section_read("analytics")])
def contracts_status_analytics(request):
    """Статус исполнения: закрытые / открытые / просроченные."""
    from contracts.models import Contract
    today = timezone.localdate()
    qs = Contract.objects.all()
    overdue = qs.filter(status="in_progress", deadline__lt=today).count()
    by_status = {r["status"]: r["c"] for r in qs.values("status").annotate(c=Count("id"))}
    return Response({
        "by_status": by_status,
        "open": sum(by_status.get(s, 0) for s in ("new", "negotiation", "in_progress")),
        "closed": by_status.get("closed", 0),
        "cancelled": by_status.get("cancelled", 0),
        "overdue": overdue,
        "total_amount": float(qs.aggregate(s=Sum("amount"))["s"] or 0),
    })


@api_view(["GET"])
# Дашборд — стартовая страница для всех ролей; денежные показатели
# внутри скрываются через show_money, поэтому раздел здесь не требуется.
@permission_classes([IsAuthenticated])
def dashboard(request):
    """KPI для главного экрана. Денежные показатели — только тем, кто видит финансы."""
    from contracts.models import Contract
    from finance.models import CashEntry
    from warehouse.models import Material
    from production.models import ProductionOrder
    from accounts.permissions import can_read
    show_money = can_read(request.user, "finance")
    today = timezone.localdate()
    month_start = today.replace(day=1)

    income_m = CashEntry.objects.filter(direction="in", date__gte=month_start).aggregate(s=Sum("amount"))["s"] or 0
    expense_m = CashEntry.objects.filter(direction="out", date__gte=month_start).aggregate(s=Sum("amount"))["s"] or 0
    balance = ((CashEntry.objects.filter(direction="in").aggregate(s=Sum("amount"))["s"] or 0)
               - (CashEntry.objects.filter(direction="out").aggregate(s=Sum("amount"))["s"] or 0))

    # Material.stock — свойство с отдельным запросом на каждый материал,
    # поэтому цикл по всем материалам давал N+1. Считаем одним запросом.
    low_stock = (
        Material.objects
        .filter(min_stock__gt=0)
        .annotate(_stock=Coalesce(
            Sum("movements__qty"),
            Value(Decimal("0")),
            output_field=DecimalField(max_digits=12, decimal_places=3),
        ))
        .filter(_stock__lt=F("min_stock"))
        .count()
    )

    series_rows = (CashEntry.objects.annotate(m=TruncMonth("date"))
                   .values("m", "direction").annotate(t=Sum("amount")).order_by("m"))
    months = defaultdict(lambda: {"income": 0, "expense": 0})
    for r in series_rows:
        k = r["m"].strftime("%Y-%m")
        months[k]["income" if r["direction"] == "in" else "expense"] = float(r["t"])
    series = [{"month": k, **v, "profit": v["income"] - v["expense"]} for k, v in sorted(months.items())]

    data = {
        "show_money": show_money,
        "contracts_open": Contract.objects.exclude(status__in=["closed", "cancelled"]).count(),
        "contracts_overdue": Contract.objects.filter(status="in_progress", deadline__lt=today).count(),
        "production_in_progress": ProductionOrder.objects.filter(status="in_progress").count(),
        "low_stock_materials": low_stock,
    }
    if show_money:
        data.update({
            "cash_balance": float(balance),
            "month_income": float(income_m),
            "month_expense": float(expense_m),
            "month_profit": float(income_m - expense_m),
            "monthly_series": series,
        })
    return Response(data)
