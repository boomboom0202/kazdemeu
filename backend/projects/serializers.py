from decimal import Decimal
from django.db.models import Max, Q
from rest_framework import serializers
from .models import (Project, ProjectExpense, ProjectIncome, AdminCategory, AdminExpense,
                     ExpenseKind)
from .calc import project_stats, classify, f


def _next_position(model, **flt):
    return (model.objects.filter(**flt).aggregate(m=Max("position"))["m"] or 0) + 1


class ProjectExpenseSerializer(serializers.ModelSerializer):
    kind = serializers.ChoiceField(choices=ExpenseKind.choices, required=False)
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)

    class Meta:
        model = ProjectExpense
        fields = "__all__"
        read_only_fields = ["source", "position"]

    def create(self, validated_data):
        # вид не выбран — определяем по комментарию, как при загрузке из Excel
        if not validated_data.get("kind"):
            validated_data["kind"] = classify(validated_data.get("comment"))
        validated_data["position"] = _next_position(ProjectExpense, project=validated_data["project"])
        return super().create(validated_data)


class ProjectIncomeSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectIncome
        fields = "__all__"
        read_only_fields = ["source", "position"]

    def create(self, validated_data):
        validated_data["position"] = _next_position(ProjectIncome, project=validated_data["project"])
        return super().create(validated_data)


class ProjectSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    stats = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = "__all__"

    def get_stats(self, obj):
        return project_stats(obj)


class ProjectDetailSerializer(ProjectSerializer):
    expenses = ProjectExpenseSerializer(many=True, read_only=True)
    incomes = ProjectIncomeSerializer(many=True, read_only=True)
    contracts = serializers.SerializerMethodField()
    by_kind = serializers.SerializerMethodField()
    work_orders = serializers.SerializerMethodField()

    def get_contracts(self, obj):
        return [{"id": c.id, "number": c.number, "purchase_no": c.purchase_no, "title": c.title,
                 "customer_name": c.customer.name, "qty": c.qty, "price": c.price,
                 "amount": f(c.amount), "paid_amount": f(c.paid_amount),
                 "contract_no": c.contract_no, "status": c.status,
                 "status_display": c.get_status_display(),
                 "own_company_name": c.own_company.name if c.own_company else None}
                for c in obj.contracts.all()]

    def get_by_kind(self, obj):
        """Куда ушли деньги проекта — по видам трат."""
        total = sum((e.amount for e in obj.expenses.all()), Decimal("0"))
        acc = {}
        for e in obj.expenses.all():
            acc[e.kind] = acc.get(e.kind, Decimal("0")) + e.amount
        labels = dict(ExpenseKind.choices)
        return [{"kind": k, "label": labels.get(k, k), "total": f(v),
                 "share": round(float(v / total * 100), 1) if total else 0}
                for k, v in sorted(acc.items(), key=lambda kv: -kv[1])]

    def get_work_orders(self, obj):
        from accounts.permissions import can_read
        request = self.context.get("request")
        if not (request and can_read(request.user, "workshop.orders")):
            return None
        from workshop.models import WorkOrder
        from workshop.calc import with_details, order_stats
        orders = with_details(WorkOrder.objects.filter(
            Q(project=obj) | Q(contract__project=obj)).distinct())
        return [{"id": o.id, "product": o.product, "status_display": o.get_status_display(),
                 "deadline": o.deadline, "totals": order_stats(o)} for o in orders]


class AdminCategorySerializer(serializers.ModelSerializer):
    total = serializers.SerializerMethodField()
    count = serializers.SerializerMethodField()

    class Meta:
        model = AdminCategory
        fields = "__all__"

    def get_total(self, obj):
        return f(sum((e.amount for e in obj.expenses.all()), Decimal("0")))

    def get_count(self, obj):
        return len(obj.expenses.all())


class AdminExpenseSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)

    class Meta:
        model = AdminExpense
        fields = "__all__"
        read_only_fields = ["source", "position"]

    def validate_month(self, value):
        return value.replace(day=1) if value else value

    def create(self, validated_data):
        validated_data["position"] = _next_position(AdminExpense, category=validated_data["category"])
        return super().create(validated_data)
