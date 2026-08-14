from rest_framework import serializers
from .models import (Product, BOMItem, PriceList, PriceListItem,
                     ProductionOrder, ProductionStage, StageTemplate)


class BOMItemSerializer(serializers.ModelSerializer):
    material_name = serializers.CharField(source="material.name", read_only=True)
    material_unit = serializers.CharField(source="material.unit", read_only=True)
    material_price = serializers.DecimalField(source="material.avg_price", max_digits=12,
                                              decimal_places=2, read_only=True)

    class Meta:
        model = BOMItem
        fields = "__all__"


class StageTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = StageTemplate
        fields = "__all__"


class ProductSerializer(serializers.ModelSerializer):
    material_cost = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    cost_price = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    overhead = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    margin = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    margin_percent = serializers.FloatField(read_only=True)
    fg_stock = serializers.IntegerField(read_only=True)

    class Meta:
        model = Product
        fields = "__all__"


class ProductDetailSerializer(ProductSerializer):
    bom_items = BOMItemSerializer(many=True, read_only=True)
    qr = serializers.SerializerMethodField()

    def get_qr(self, obj):
        return obj.qr_base64()


class PriceListItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)

    class Meta:
        model = PriceListItem
        fields = "__all__"


class PriceListSerializer(serializers.ModelSerializer):
    items = PriceListItemSerializer(many=True, read_only=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True, default=None)

    class Meta:
        model = PriceList
        fields = "__all__"


class ProductionStageSerializer(serializers.ModelSerializer):
    stage_label = serializers.SerializerMethodField()
    assignee_name = serializers.CharField(source="assignee.username", read_only=True, default=None)
    order_number = serializers.CharField(source="order.number", read_only=True)
    deviation_hours = serializers.SerializerMethodField()

    class Meta:
        model = ProductionStage
        fields = "__all__"

    def get_stage_label(self, obj):
        return obj.label

    def get_deviation_hours(self, obj):
        return float(obj.actual_hours - obj.norm_hours)


class ProductionOrderSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    contract_number = serializers.CharField(source="contract.number", read_only=True, default=None)
    stages = ProductionStageSerializer(many=True, read_only=True)

    class Meta:
        model = ProductionOrder
        fields = "__all__"
