from rest_framework import serializers
from .models import Tender, Platform, OwnCompany


class PlatformSerializer(serializers.ModelSerializer):
    class Meta:
        model = Platform
        fields = "__all__"


class OwnCompanySerializer(serializers.ModelSerializer):
    class Meta:
        model = OwnCompany
        fields = "__all__"


class TenderSerializer(serializers.ModelSerializer):
    platform_name = serializers.CharField(source="platform.name", read_only=True, default=None)
    own_company_name = serializers.CharField(source="own_company.name", read_only=True, default=None)
    product_name = serializers.CharField(source="product.name", read_only=True, default=None)
    manager_name = serializers.CharField(source="manager.username", read_only=True, default=None)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    contract_number = serializers.CharField(source="contract.number", read_only=True, default=None)

    customer_total = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)
    plan_total = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)
    cost_total = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)
    profit = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)
    margin_percent = serializers.FloatField(read_only=True)
    days_left = serializers.IntegerField(read_only=True)
    is_urgent = serializers.BooleanField(read_only=True)
    allowed_transitions = serializers.SerializerMethodField()

    class Meta:
        model = Tender
        fields = "__all__"

    def get_allowed_transitions(self, obj):
        return sorted(map(str, Tender.TRANSITIONS.get(obj.status, set())))
