from collections import defaultdict
from decimal import Decimal
from rest_framework import viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from accounts.permissions import section_read
from rest_framework.response import Response
from django.db.models import Sum, Q
from django.db.models.functions import TruncMonth
from accounts.permissions import RoleSectionPermission
from accounts.mixins import SafeDestroyMixin
from .models import ExpenseCategory, CashEntry, FixedCost, CostSettings
from .serializers import (ExpenseCategorySerializer, CashEntrySerializer,
                          FixedCostSerializer, CostSettingsSerializer)


class ExpenseCategoryViewSet(SafeDestroyMixin, viewsets.ModelViewSet):
    queryset = ExpenseCategory.objects.all().order_by("name")
    serializer_class = ExpenseCategorySerializer
    permission_classes = [RoleSectionPermission]
    section = "finance"


class CashEntryViewSet(SafeDestroyMixin, viewsets.ModelViewSet):
    queryset = CashEntry.objects.select_related("category", "contract")
    serializer_class = CashEntrySerializer
    permission_classes = [RoleSectionPermission]
    section = "finance"
    filterset_fields = ["direction", "category", "contract"]


class FixedCostViewSet(SafeDestroyMixin, viewsets.ModelViewSet):
    """Постоянные расходы — вводятся один раз, действуют ежемесячно."""
    queryset = FixedCost.objects.select_related("category")
    serializer_class = FixedCostSerializer
    permission_classes = [RoleSectionPermission]
    section = "finance"
    filterset_fields = ["is_active"]


@api_view(["GET", "PATCH"])
@permission_classes([section_read("finance")])
def cost_settings(request):
    """Настройки расчёта себестоимости (одна запись).

    Читают те, у кого есть доступ к финансам, меняют — у кого есть право записи.
    Раньше чтение было открыто всем вошедшим, а оно отдаёт сумму постоянных
    расходов и ставку накладных — это финансовые данные.
    """
    from accounts.permissions import can_write
    obj = CostSettings.get_solo()
    if request.method == "PATCH":
        if not can_write(request.user, "finance"):
            return Response({"detail": "Недостаточно прав."}, status=403)
        ser = CostSettingsSerializer(obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)
    return Response(CostSettingsSerializer(obj).data)


def _month_series(qs):
    rows = (qs.annotate(m=TruncMonth("date")).values("m", "direction")
              .annotate(total=Sum("amount")).order_by("m"))
    by_month = defaultdict(lambda: {"income": 0, "expense": 0})
    for r in rows:
        key = r["m"].strftime("%Y-%m")
        if r["direction"] == "in":
            by_month[key]["income"] = float(r["total"])
        else:
            by_month[key]["expense"] = float(r["total"])
    out, balance = [], 0.0
    for m in sorted(by_month):
        d = by_month[m]
        net = d["income"] - d["expense"]
        balance += net
        out.append({"month": m, **d, "net": net, "balance": balance})
    return out


@api_view(["GET"])
@permission_classes([section_read("finance")])
def cashflow_report(request):
    """ДДС/ОДДС: помесячно приход/расход/чистый поток/остаток."""
    return Response({
        "series": _month_series(CashEntry.objects.all()),
        "balance": float(
            (CashEntry.objects.filter(direction="in").aggregate(s=Sum("amount"))["s"] or 0)
            - (CashEntry.objects.filter(direction="out").aggregate(s=Sum("amount"))["s"] or 0)),
    })


@api_view(["GET"])
@permission_classes([section_read("finance")])
def pnl_report(request):
    """ОПиУ: доходы/расходы по категориям, чистая прибыль, рентабельность,
    структура расходов и деление постоянные/переменные."""
    income = CashEntry.objects.filter(direction="in").aggregate(s=Sum("amount"))["s"] or Decimal(0)
    exp_rows = (CashEntry.objects.filter(direction="out")
                .values("category__name", "category__kind").annotate(total=Sum("amount")))
    expenses = [{"category": r["category__name"] or "Без категории",
                 "kind": r["category__kind"] or "variable",
                 "total": float(r["total"])} for r in exp_rows]
    total_exp = sum(e["total"] for e in expenses)
    net = float(income) - total_exp
    return Response({
        "income": float(income),
        "expenses": expenses,
        "total_expenses": total_exp,
        "net_profit": net,
        "profitability_percent": round(net / float(income) * 100, 2) if income else 0,
        "fixed_total": sum(e["total"] for e in expenses if e["kind"] == "fixed"),
        "variable_total": sum(e["total"] for e in expenses if e["kind"] == "variable"),
    })


@api_view(["GET"])
@permission_classes([section_read("finance")])
def forecast_report(request):
    """Потенциальные поступления (воронка): взвешенные по стадии договора +
    неоплаченный остаток графика платежей."""
    from contracts.models import Contract
    weights = {"new": 0.1, "negotiation": 0.4, "in_progress": 0.9}
    funnel = []
    expected = 0.0
    for c in Contract.objects.exclude(status__in=["closed", "cancelled"]):
        remaining = float(c.amount) - float(c.paid_amount)
        w = weights.get(c.status, 0)
        funnel.append({"contract": c.number, "customer": c.customer.name,
                       "status": c.status, "remaining": remaining,
                       "probability": w, "weighted": remaining * w})
        expected += remaining * w
    return Response({"funnel": funnel, "expected_total": round(expected, 2)})
