from rest_framework import serializers
from .models import Customer, Contract, PaymentScheduleItem, ContractFile, Comment


class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = "__all__"


class PaymentScheduleItemSerializer(serializers.ModelSerializer):
    is_paid = serializers.BooleanField(read_only=True)

    class Meta:
        model = PaymentScheduleItem
        fields = "__all__"


class ContractFileSerializer(serializers.ModelSerializer):
    uploaded_by_name = serializers.CharField(source="uploaded_by.username", read_only=True, default=None)

    class Meta:
        model = ContractFile
        fields = "__all__"
        read_only_fields = ["uploaded_by"]


class CommentSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source="author.username", read_only=True, default=None)

    class Meta:
        model = Comment
        fields = "__all__"
        read_only_fields = ["author"]


class ContractSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    manager_name = serializers.CharField(source="manager.username", read_only=True, default=None)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    paid_amount = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    is_overdue = serializers.BooleanField(read_only=True)

    class Meta:
        model = Contract
        fields = "__all__"

    def validate_status(self, value):
        # При заведении договора статус любой: в систему вносят и те, что
        # давно в работе. А вот у существующего договора статус движется
        # только по цепочке — тем же правилом, что и кнопки в карточке.
        if self.instance is None:
            return value
        err = self.instance.transition_error(value)
        if err:
            raise serializers.ValidationError(err)
        return value


class ContractDetailSerializer(ContractSerializer):
    payment_schedule = PaymentScheduleItemSerializer(many=True, read_only=True)
    files = ContractFileSerializer(many=True, read_only=True)
    comments = CommentSerializer(many=True, read_only=True)
    allowed_transitions = serializers.SerializerMethodField()

    def get_allowed_transitions(self, obj):
        return sorted(map(str, Contract.TRANSITIONS.get(obj.status, set())))
