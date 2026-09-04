from collections import defaultdict
from datetime import date, timedelta
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
    access_key = "finance.entries"
    queryset = CashEntry.objects.select_related("category", "contract")
    serializer_class = CashEntrySerializer
    permission_classes = [RoleSectionPermission]
    section = "finance"
    filterset_fields = ["direction", "category", "contract"]


class FixedCostViewSet(SafeDestroyMixin, viewsets.ModelViewSet):
    """Постоянные расходы — вводятся один раз, действуют ежемесячно."""
    access_key = "finance.fixed"
    queryset = FixedCost.objects.select_related("category")
    serializer_class = FixedCostSerializer
    permission_classes = [RoleSectionPermission]
    section = "finance"
    filterset_fields = ["is_active"]


@api_view(["GET", "PATCH"])
@permission_classes([section_read("finance.settings")])
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
@permission_classes([section_read("finance.reports")])
def cashflow_report(request):
    """ДДС/ОДДС: помесячно приход/расход/чистый поток/остаток."""
    return Response({
        "series": _month_series(CashEntry.objects.all()),
        "balance": float(
            (CashEntry.objects.filter(direction="in").aggregate(s=Sum("amount"))["s"] or 0)
            - (CashEntry.objects.filter(direction="out").aggregate(s=Sum("amount"))["s"] or 0)),
    })


@api_view(["GET"])
@permission_classes([section_read("finance.reports")])
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
@permission_classes([section_read("finance.reports")])
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


@api_view(["GET"])
@permission_classes([section_read("finance.fixed")])
def fixed_costs_plan_fact(request):
    """Сверка постоянных расходов: норматив против фактических выплат.

    Себестоимость считается по нормативу («аренда обходится в 450 000
    в месяц») — иначе в месяц квартального платежа изделие дорожало бы
    втрое. ОПиУ показывает факт. Расхождение между ними и есть то, ради
    чего постоянный расход вводится отдельно от операции по кассе, но
    до сих пор его негде было увидеть: поле «Категория» у постоянного
    расхода хранилось и никак не использовалось.

    Сверка идёт по категории: у нескольких постоянных расходов она может
    совпадать, поэтому план и факт складываются по категории, а не по
    отдельной строке.
    """
    from django.utils import timezone
    from collections import OrderedDict

    today = timezone.localdate()
    month_start = today.replace(day=1)
    if request.query_params.get("month"):          # YYYY-MM, для сверки за прошлые месяцы
        try:
            y, m = request.query_params["month"].split("-")
            month_start = date(int(y), int(m), 1)
        except (ValueError, TypeError):
            pass
    next_month = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)

    facts = {
        r["category_id"]: r["total"]
        for r in CashEntry.objects.filter(direction="out", date__gte=month_start,
                                          date__lt=next_month)
        .values("category_id").annotate(total=Sum("amount"))
    }

    rows, without_category = OrderedDict(), []
    for fc in FixedCost.objects.filter(is_active=True).select_related("category"):
        if fc.category_id is None:
            without_category.append({"name": fc.name, "plan": float(fc.monthly_amount)})
            continue
        row = rows.setdefault(fc.category_id, {
            "category": fc.category.name, "plan": 0.0, "items": []})
        row["plan"] += float(fc.monthly_amount)
        row["items"].append(fc.name)

    result = []
    for cat_id, row in rows.items():
        fact = float(facts.get(cat_id) or 0)
        result.append({**row, "fact": fact, "diff": round(fact - row["plan"], 2)})
    result.sort(key=lambda r: -r["plan"])

    plan_total = sum(r["plan"] for r in result) + sum(r["plan"] for r in without_category)
    fact_total = sum(r["fact"] for r in result)
    return Response({
        "month": month_start.strftime("%Y-%m"),
        "rows": result,
        "without_category": without_category,
        "plan_total": round(plan_total, 2),
        "fact_total": round(fact_total, 2),
        "diff_total": round(fact_total - plan_total, 2),
    })
