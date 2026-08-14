from rest_framework import serializers
from .models import ExpenseCategory, CashEntry, FixedCost, CostSettings


class FixedCostSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True, default=None)

    class Meta:
        model = FixedCost
        fields = "__all__"


class CostSettingsSerializer(serializers.ModelSerializer):
    monthly_fixed_total = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    overhead_rate = serializers.DecimalField(max_digits=14, decimal_places=4, read_only=True)

    class Meta:
        model = CostSettings
        fields = "__all__"


class ExpenseCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ExpenseCategory
        fields = "__all__"


class CashEntrySerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True, default=None)
    contract_number = serializers.CharField(source="contract.number", read_only=True, default=None)

    class Meta:
        model = CashEntry
        fields = "__all__"
