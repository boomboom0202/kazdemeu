from rest_framework import serializers
from .models import Supplier, Material, MaterialBatch, StockMovement, FinishedGoodsMovement, PurchaseOrder


class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = "__all__"


class MaterialSerializer(serializers.ModelSerializer):
    stock = serializers.DecimalField(max_digits=12, decimal_places=3, read_only=True)
    avg_price = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    default_supplier_name = serializers.CharField(source="default_supplier.name", read_only=True, default=None)
    low_stock = serializers.SerializerMethodField()

    class Meta:
        model = Material
        fields = "__all__"

    def get_low_stock(self, obj):
        return bool(obj.min_stock and obj.stock < obj.min_stock)


class MaterialBatchSerializer(serializers.ModelSerializer):
    material_name = serializers.CharField(source="material.name", read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True, default=None)

    class Meta:
        model = MaterialBatch
        fields = "__all__"


class StockMovementSerializer(serializers.ModelSerializer):
    material_name = serializers.CharField(source="material.name", read_only=True)
    material_unit = serializers.CharField(source="material.unit", read_only=True)
    reason_display = serializers.CharField(source="get_reason_display", read_only=True)
    created_by_name = serializers.CharField(source="created_by.username", read_only=True, default=None)

    class Meta:
        model = StockMovement
        fields = "__all__"
        read_only_fields = ["created_by"]


class FinishedGoodsMovementSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)

    class Meta:
        model = FinishedGoodsMovement
        fields = "__all__"


class PurchaseOrderSerializer(serializers.ModelSerializer):
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    material_name = serializers.CharField(source="material.name", read_only=True)

    class Meta:
        model = PurchaseOrder
        fields = "__all__"
