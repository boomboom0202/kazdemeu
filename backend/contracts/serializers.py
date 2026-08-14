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


class ContractDetailSerializer(ContractSerializer):
    payment_schedule = PaymentScheduleItemSerializer(many=True, read_only=True)
    files = ContractFileSerializer(many=True, read_only=True)
    comments = CommentSerializer(many=True, read_only=True)
    allowed_transitions = serializers.SerializerMethodField()

    def get_allowed_transitions(self, obj):
        return sorted(map(str, Contract.TRANSITIONS.get(obj.status, set())))
