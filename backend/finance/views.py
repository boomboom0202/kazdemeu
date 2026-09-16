"""Финансы: сводка денег по договорам и месяцам, административные расходы,
прочие поступления."""
from collections import OrderedDict
from decimal import Decimal
from django.db import transaction
from django.db.models import Sum
from django.db.models.functions import TruncMonth
from rest_framework import viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from accounts.permissions import RoleSectionPermission, section_read, can_write
from accounts.mixins import SafeDestroyMixin
from contracts.excel import read_blocks, money
from contracts.models import Source
from .calc import assign_months
from .models import AdminCategory, AdminExpense, OtherIncome
from .serializers import AdminCategorySerializer, AdminExpenseSerializer, OtherIncomeSerializer

ZERO = Decimal("0")
NO_DATE = "none"


def _f(v):
    return float(round(Decimal(v or 0), 2))


def _load_sheet(request):
    from openpyxl import load_workbook
    file = request.FILES.get("file")
    if not file:
        return None, Response({"detail": "Файл не передан."}, status=400)
    try:
        return load_workbook(file, data_only=True).active, None
    except Exception:
        return None, Response({"detail": "Не удалось открыть файл. Нужен формат .xlsx."}, status=400)


class Base(SafeDestroyMixin, viewsets.ModelViewSet):
    permission_classes = [RoleSectionPermission]
    section = "finance"


class AdminCategoryViewSet(Base):
    access_key = "finance.admin"
    queryset = AdminCategory.objects.prefetch_related("expenses")
    serializer_class = AdminCategorySerializer


class AdminExpenseViewSet(Base):
    access_key = "finance.admin"
    queryset = AdminExpense.objects.select_related("category")
    serializer_class = AdminExpenseSerializer
    filterset_fields = {"category": ["exact"], "month": ["exact", "isnull"], "source": ["exact"]}
    search_fields = ["comment"]

    @action(detail=False, methods=["get"])
    def summary(self, request):
        """Статья × месяц — то, чего нет в самой таблице, но что из неё следует.
        Рядом с фактом — план статьи в месяц, если он задан."""
        rows = (AdminExpense.objects.values("category_id", "month")
                .annotate(total=Sum("amount")).order_by())
        cats = OrderedDict((c.id, {"id": c.id, "name": c.name, "monthly_plan": _f(c.monthly_plan),
                                   "total": 0.0, "months": {}})
                           for c in AdminCategory.objects.all())
        months, by_month = set(), {}
        for r in rows:
            key = r["month"].strftime("%Y-%m") if r["month"] else NO_DATE
            v = _f(r["total"])
            months.add(key)
            c = cats.get(r["category_id"])
            if c:
                c["months"][key] = round(c["months"].get(key, 0) + v, 2)
                c["total"] = round(c["total"] + v, 2)
            by_month[key] = round(by_month.get(key, 0) + v, 2)
        order = sorted(m for m in months if m != NO_DATE) + ([NO_DATE] if NO_DATE in months else [])
        return Response({"categories": list(cats.values()), "months": order, "by_month": by_month,
                         "total": round(sum(by_month.values()), 2),
                         "plan_total": round(sum(c["monthly_plan"] for c in cats.values()), 2)})

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser])
    def import_excel(self, request):
        """Загрузка «Расход административные.xlsx»: пара колонок — статья.

        Месяц достаётся из комментария, у строк без месяца — от строки выше.
        Повторная загрузка заменяет строки из Excel у статей файла, ручные остаются.
        """
        if not can_write(request.user, "finance.admin"):
            return Response({"detail": "Нет права вносить административные расходы."}, status=403)
        ws, err = _load_sheet(request)
        if err:
            return err
        blocks = read_blocks(ws)
        if not blocks:
            return Response({"detail": "Не нашёл статей: названия должны быть в первой строке, "
                                       "под каждой — сумма и комментарий."}, status=400)
        rep = {"categories_created": 0, "expenses": 0, "without_month": 0, "warnings": []}
        with transaction.atomic():
            resolved, cleared = [], set()
            for i, (name, lines) in enumerate(blocks):
                title = name[:1].upper() + name[1:]
                cat = AdminCategory.objects.filter(name__iexact=title).first()
                if not cat:
                    cat = AdminCategory.objects.create(name=title[:150], position=i)
                    rep["categories_created"] += 1
                if cat.id not in cleared:
                    AdminExpense.objects.filter(category=cat, source=Source.EXCEL).delete()
                    cleared.add(cat.id)
                resolved.append((cat, name, lines))
            for cat, name, lines in resolved:
                months = assign_months([t for _, _, t in lines])
                base = AdminExpense.objects.filter(category=cat).count()
                for pos, ((row, raw, text), month) in enumerate(zip(lines, months), start=1):
                    amount = money(raw)
                    if amount is None or amount <= 0:
                        if raw not in (None, ""):
                            rep["warnings"].append(f"«{name}», строка {row}: «{raw}» — не сумма, пропущено.")
                        continue
                    AdminExpense.objects.create(category=cat, amount=amount, comment=text[:255],
                                                month=month, source=Source.EXCEL, position=base + pos)
                    rep["expenses"] += 1
                    rep["without_month"] += month is None
        return Response(rep)


class OtherIncomeViewSet(Base):
    access_key = "finance.income"
    queryset = OtherIncome.objects.all()
    serializer_class = OtherIncomeSerializer


def _by_month(qs, field, amount="amount"):
    """{YYYY-MM | none: сумма} одним запросом."""
    out = {}
    rows = (qs.annotate(m=TruncMonth(field)).values("m").annotate(t=Sum(amount)).order_by())
    for r in rows:
        key = r["m"].strftime("%Y-%m") if r["m"] else NO_DATE
        out[key] = out.get(key, 0.0) + _f(r["t"])
    return out


@api_view(["GET"])
@permission_classes([section_read("finance.reports")])
def summary(request):
    return Response(build_summary())


def build_summary():
    """Сводка денег: сколько заказчики заплатили, сколько ушло на договоры
    и на административные расходы — всего и по месяцам, и по каждому договору.

    Строки «Расходов», загруженные из Excel, даты не имеют — они собираются
    в колонку «без даты», а не размазываются по месяцам.
    """
    from contracts.models import Contract, ContractPayment, ContractExpense, ExpenseKind

    contracts = list(Contract.objects.exclude(status=Contract.Status.CANCELLED)
                     .select_related("customer").prefetch_related("payments", "expenses"))
    from .allocation import admin_shares
    shares = admin_shares(contracts)
    rows = []
    tot = {"amount": ZERO, "paid": ZERO, "expenses": ZERO}
    minus = 0
    for c in contracts:
        paid, spent = c.paid_amount, c.expenses_total
        share = shares.get(c.id, ZERO)
        tot["amount"] += c.amount
        tot["paid"] += paid
        tot["expenses"] += spent
        if spent and paid - spent < 0:
            minus += 1
        rows.append({"id": c.id, "number": c.purchase_no or c.number, "customer": c.customer.name,
                     "title": c.title, "status": c.status, "status_display": c.get_status_display(),
                     "amount": _f(c.amount), "paid": _f(paid), "expenses": _f(spent),
                     "profit": _f(c.amount - spent), "balance": _f(paid - spent),
                     "debt": _f(max(c.amount - paid, ZERO)),
                     "admin_share": _f(share), "net_profit": _f(c.amount - spent - share)})

    active = ContractPayment.objects.exclude(contract__status=Contract.Status.CANCELLED)
    spent_qs = ContractExpense.objects.exclude(contract__status=Contract.Status.CANCELLED)
    income_m = _by_month(active, "date")
    expense_m = _by_month(spent_qs, "date")
    admin_m = _by_month(AdminExpense.objects.all(), "month")
    other_m = _by_month(OtherIncome.objects.all(), "date")

    keys = set(income_m) | set(expense_m) | set(admin_m) | set(other_m)
    order = sorted(k for k in keys if k != NO_DATE) + ([NO_DATE] if NO_DATE in keys else [])
    months, running = [], 0.0
    for k in order:
        inc, oth = income_m.get(k, 0.0), other_m.get(k, 0.0)
        exp, adm = expense_m.get(k, 0.0), admin_m.get(k, 0.0)
        net = round(inc + oth - exp - adm, 2)
        running = round(running + net, 2)
        months.append({"month": k, "income": round(inc, 2), "other_income": round(oth, 2),
                       "contract_expenses": round(exp, 2), "admin_expenses": round(adm, 2),
                       "net": net, "cumulative": running})

    labels = dict(ExpenseKind.choices)
    kinds = [{"kind": r["kind"], "label": labels.get(r["kind"], r["kind"]), "total": _f(r["t"])}
             for r in spent_qs.values("kind").annotate(t=Sum("amount")).order_by("-t")]

    admin_total = _f(AdminExpense.objects.aggregate(s=Sum("amount"))["s"])
    other_total = _f(OtherIncome.objects.aggregate(s=Sum("amount"))["s"])
    paid, spent = _f(tot["paid"]), _f(tot["expenses"])
    return ({
        "contracts_count": len(contracts),
        "contracts_amount": _f(tot["amount"]),
        "paid": paid,
        "debt": round(sum(r["debt"] for r in rows), 2),
        "contract_expenses": spent,
        "contracts_profit": round(_f(tot["amount"]) - spent, 2),
        "admin_expenses": admin_total,
        "other_income": other_total,
        # живые деньги: всё полученное минус всё потраченное
        "cash": round(paid + other_total - spent - admin_total, 2),
        # итог, когда заказчики доплатят долги
        "expected_result": round(_f(tot["amount"]) + other_total - spent - admin_total, 2),
        "minus_count": minus,
        "months": months,
        "kinds": kinds,
        "contracts": rows,
    })

