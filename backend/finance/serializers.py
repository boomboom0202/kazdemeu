from decimal import Decimal
from django.db.models import Max
from rest_framework import serializers
from .models import AdminCategory, AdminExpense, OtherIncome


def _f(v):
    return float(round(Decimal(v), 2))


class AdminCategorySerializer(serializers.ModelSerializer):
    total = serializers.SerializerMethodField()
    count = serializers.SerializerMethodField()

    class Meta:
        model = AdminCategory
        fields = "__all__"

    def get_total(self, obj):
        return _f(sum((e.amount for e in obj.expenses.all()), Decimal("0")))

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
        top = (AdminExpense.objects.filter(category=validated_data["category"])
               .aggregate(m=Max("position"))["m"] or 0)
        validated_data["position"] = top + 1
        return super().create(validated_data)


class OtherIncomeSerializer(serializers.ModelSerializer):
    class Meta:
        model = OtherIncome
        fields = "__all__"
