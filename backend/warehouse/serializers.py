from rest_framework import serializers
from .models import Supplier, Material, MaterialBatch, StockMovement, GoodsMovement


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
    material_unit = serializers.CharField(source="material.unit", read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True, default=None)

    class Meta:
        model = MaterialBatch
        fields = "__all__"


class StockMovementSerializer(serializers.ModelSerializer):
    material_name = serializers.CharField(source="material.name", read_only=True)
    material_unit = serializers.CharField(source="material.unit", read_only=True)
    reason_display = serializers.CharField(source="get_reason_display", read_only=True)
    created_by_name = serializers.CharField(source="created_by.username", read_only=True, default=None)
    work_order_label = serializers.CharField(source="work_order.product", read_only=True, default=None)

    class Meta:
        model = StockMovement
        fields = "__all__"
        read_only_fields = ["created_by", "batch"]

    def validate(self, attrs):
        """Выдать больше, чем лежит, нельзя; приход вносится партией, а не движением."""
        qty = attrs.get("qty")
        if qty is None or qty == 0:
            raise serializers.ValidationError({"qty": "Количество не может быть нулевым."})
        if attrs.get("reason") == StockMovement.Reason.PURCHASE:
            raise serializers.ValidationError(
                {"reason": "Приход вносится партией — во вкладке «Приход»."})
        material = attrs["material"]
        if qty < 0 and material.stock + qty < 0:
            raise serializers.ValidationError(
                {"qty": f"На складе {material.stock} {material.unit} «{material.name}», "
                        f"выдать {abs(qty)} нельзя."})
        return attrs


class GoodsMovementSerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    contract_number = serializers.SerializerMethodField()
    created_by_name = serializers.CharField(source="created_by.username", read_only=True, default=None)

    class Meta:
        model = GoodsMovement
        fields = "__all__"
        read_only_fields = ["created_by"]

    def get_contract_number(self, obj):
        c = obj.contract
        return (c.purchase_no or c.number) if c else None

    def validate(self, attrs):
        from .goods import line_stock
        order = attrs.get("work_order")
        if order is not None:
            # строка заказа: изделие и договор берутся из заказа цеха
            attrs["product"] = order.product
            if attrs.get("contract") is None:
                attrs["contract"] = order.contract
        if not (attrs.get("product") or "").strip():
            raise serializers.ValidationError({"product": "Укажите изделие."})
        if (attrs.get("size") or "").strip():
            from workshop.sizes import normalize_size
            size, err = normalize_size(attrs["size"])
            if err:
                raise serializers.ValidationError({"size": err})
            attrs["size"] = size
        if attrs["kind"] == GoodsMovement.Kind.OUT:
            have = line_stock(attrs.get("work_order"), attrs["product"], attrs.get("size", ""))
            if attrs["qty"] > have:
                raise serializers.ValidationError(
                    {"qty": f"На складе {have} шт «{attrs['product']}» "
                            f"{attrs.get('size') or ''}, отгрузить {attrs['qty']} нельзя.".replace("  ", " ")})
        return attrs
