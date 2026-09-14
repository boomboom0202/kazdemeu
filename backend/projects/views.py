from collections import OrderedDict
from decimal import Decimal
from django.db import transaction
from django.db.models import Sum
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from accounts.permissions import RoleSectionPermission, can_read, can_write
from accounts.mixins import SafeDestroyMixin
from .calc import read_blocks, money, classify, assign_months, TOTAL_WORDS, f, project_stats
from .models import (Project, ProjectExpense, ProjectIncome, AdminCategory, AdminExpense, Source)
from .serializers import (ProjectSerializer, ProjectDetailSerializer, ProjectExpenseSerializer,
                          ProjectIncomeSerializer, AdminCategorySerializer, AdminExpenseSerializer)

ZERO = Decimal("0")


def _sp(v):
    return f"{v:,.0f}".replace(",", " ")


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
    section = "projects"


class ProjectViewSet(Base):
    access_key = "projects.projects"
    queryset = Project.objects.prefetch_related(
        "expenses", "incomes", "contracts__customer", "contracts__own_company",
        "contracts__payment_schedule")
    filterset_fields = ["status"]
    search_fields = ["name"]

    def get_serializer_class(self):
        return ProjectDetailSerializer if self.action == "retrieve" else ProjectSerializer

    @action(detail=False, methods=["get"])
    def summary(self, request):
        """Итоги по проектам и общий результат с учётом административных расходов."""
        keys = ["contracts_amount", "income", "expenses", "balance", "expected_profit"]
        total = dict.fromkeys(keys, 0.0)
        projects = list(self.filter_queryset(self.get_queryset()))
        minus = 0
        for p in projects:
            s = project_stats(p)
            for k in keys:
                total[k] += s[k]
            minus += s["minus"]
        total = {k: round(v, 2) for k, v in total.items()}
        admin_total = None
        if can_read(request.user, "finance.admin"):
            admin_total = f(AdminExpense.objects.aggregate(s=Sum("amount"))["s"] or ZERO)
        return Response({
            **total, "projects": len(projects), "minus_count": minus,
            "admin_expenses": admin_total,
            # что осталось у предприятия: приход проектов − их расходы − административные
            "result": round(total["balance"] - admin_total, 2) if admin_total is not None else None,
        })

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser])
    def import_expenses(self, request):
        """Загрузка «Расходы.xlsx»: каждая пара колонок — проект.

        Под названием проекта — строки «сумма | комментарий». Строка
        «приход» — это приход, строки «расход» и «остаток» — итоги таблицы:
        их не записываем, а сверяем «расход» с суммой строк выше, чтобы
        поймать арифметику, съехавшую в самой таблице.

        Повторная загрузка заменяет только загруженные из Excel строки
        этих проектов; внесённое вручную остаётся.
        """
        if not (can_write(request.user, "projects.expenses") and can_write(request.user, "projects.income")):
            return Response({"detail": "Нет права вносить расходы и приход по проектам."}, status=403)
        ws, err = _load_sheet(request)
        if err:
            return err
        blocks = read_blocks(ws)
        if not blocks:
            return Response({"detail": "Не нашёл проектов: названия должны быть в первой строке, "
                                       "под каждым — сумма и комментарий."}, status=400)
        rep = {"projects_created": 0, "projects_updated": 0, "expenses": 0, "incomes": 0,
               "warnings": []}
        with transaction.atomic():
            for name, lines in blocks:
                project = Project.objects.filter(name__iexact=name).first()
                if project:
                    rep["projects_updated"] += 1
                else:
                    project = Project.objects.create(name=name[:200])
                    rep["projects_created"] += 1
                ProjectExpense.objects.filter(project=project, source=Source.EXCEL).delete()
                ProjectIncome.objects.filter(project=project, source=Source.EXCEL).delete()
                running = ZERO
                for pos, (row, raw, text) in enumerate(lines, start=1):
                    low = text.lower().strip()
                    amount = money(raw)
                    if low in TOTAL_WORDS:
                        if low != "остаток" and amount is not None and amount != running:
                            rep["warnings"].append(
                                f"«{name}», строка {row}: в таблице «{text}» {_sp(amount)}, "
                                f"а сумма строк выше — {_sp(running)}.")
                        continue
                    if amount is None:
                        if raw not in (None, ""):
                            rep["warnings"].append(f"«{name}», строка {row}: «{raw}» — не число, пропущено.")
                        continue
                    if amount <= 0:
                        rep["warnings"].append(f"«{name}», строка {row}: сумма {raw} не больше нуля, пропущено.")
                        continue
                    if low.startswith("приход"):
                        ProjectIncome.objects.create(project=project, amount=amount, comment=text[:255],
                                                     source=Source.EXCEL, position=pos)
                        rep["incomes"] += 1
                    else:
                        ProjectExpense.objects.create(project=project, amount=amount, comment=text[:255],
                                                      kind=classify(text), source=Source.EXCEL,
                                                      position=pos)
                        running += amount
                        rep["expenses"] += 1
        return Response(rep)


class ProjectExpenseViewSet(Base):
    access_key = "projects.expenses"
    queryset = ProjectExpense.objects.select_related("project")
    serializer_class = ProjectExpenseSerializer
    filterset_fields = ["project", "kind", "source"]
    search_fields = ["comment"]


class ProjectIncomeViewSet(Base):
    access_key = "projects.income"
    queryset = ProjectIncome.objects.select_related("project")
    serializer_class = ProjectIncomeSerializer
    filterset_fields = ["project", "source"]


class AdminCategoryViewSet(Base):
    # Оклады по людям — не для всех глаз, поэтому это часть финансов,
    # а не проектов: менеджер проекты видит, зарплаты — нет.
    section = "finance"
    access_key = "finance.admin"
    queryset = AdminCategory.objects.prefetch_related("expenses")
    serializer_class = AdminCategorySerializer


class AdminExpenseViewSet(Base):
    section = "finance"
    access_key = "finance.admin"
    queryset = AdminExpense.objects.select_related("category")
    serializer_class = AdminExpenseSerializer
    filterset_fields = ["category", "month", "source"]
    search_fields = ["comment"]

    @action(detail=False, methods=["get"])
    def summary(self, request):
        """Статья × месяц — то, чего нет в самой таблице, но что из неё следует."""
        rows = (AdminExpense.objects.values("category_id", "month")
                .annotate(total=Sum("amount")).order_by())
        cats = OrderedDict((c.id, {"id": c.id, "name": c.name, "total": 0.0, "months": {}})
                           for c in AdminCategory.objects.all())
        months, by_month = set(), {}
        for r in rows:
            key = r["month"].strftime("%Y-%m") if r["month"] else "none"
            v = f(r["total"])
            months.add(key)
            c = cats.get(r["category_id"])
            if c:
                c["months"][key] = round(c["months"].get(key, 0) + v, 2)
                c["total"] = round(c["total"] + v, 2)
            by_month[key] = round(by_month.get(key, 0) + v, 2)
        order = sorted(m for m in months if m != "none") + (["none"] if "none" in months else [])
        return Response({"categories": list(cats.values()), "months": order, "by_month": by_month,
                         "total": round(sum(by_month.values()), 2)})

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser])
    def import_excel(self, request):
        """Загрузка «Расход административные.xlsx»: пара колонок — статья.

        Месяц достаётся из комментария («хайр май окл»), а у строк без месяца
        берётся от соседних — строки в листе идут по порядку. Повторная
        загрузка заменяет строки из Excel у статей файла, ручные остаются.
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
