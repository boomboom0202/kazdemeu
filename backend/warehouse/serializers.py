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

    def validate(self, attrs):
        """Отгрузить больше, чем лежит на складе, нельзя.

        Знак здесь осмыслен: плюс — приход (сдача из цеха или внесение
        начального остатка), минус — отгрузка. Без этой проверки остаток
        готовой продукции уходил в минус так же тихо, как склад материалов
        до появления проверки при запуске заказа.
        """
        qty = attrs.get("qty", getattr(self.instance, "qty", 0))
        product = attrs.get("product", getattr(self.instance, "product", None))
        if qty == 0:
            raise serializers.ValidationError({"qty": "Количество не может быть нулевым."})
        if qty < 0 and product is not None:
            stock = product.fg_stock
            if self.instance is not None:
                stock -= self.instance.qty
            if stock + qty < 0:
                raise serializers.ValidationError(
                    {"qty": f"На складе только {stock} шт «{product.name}», "
                            f"отгрузить {abs(qty)} нельзя."})
        return attrs


class PurchaseOrderSerializer(serializers.ModelSerializer):
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    material_name = serializers.CharField(source="material.name", read_only=True)

    class Meta:
        model = PurchaseOrder
        fields = "__all__"
