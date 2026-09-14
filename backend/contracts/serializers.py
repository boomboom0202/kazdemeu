from decimal import Decimal
from django.db.models import Max
from rest_framework import serializers
from accounts.permissions import can_read
from .excel import classify
from .models import (Customer, Contract, ContractPayment, ContractExpense, ContractFile, Comment,
                     ExpenseKind)


def _f(v):
    return float(round(Decimal(v), 2))


def _user(context):
    request = context.get("request")
    return request.user if request else None


class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = "__all__"


class ContractPaymentSerializer(serializers.ModelSerializer):
    contract_number = serializers.CharField(source="contract.number", read_only=True)

    class Meta:
        model = ContractPayment
        fields = "__all__"
        read_only_fields = ["source"]


class ContractExpenseSerializer(serializers.ModelSerializer):
    kind = serializers.ChoiceField(choices=ExpenseKind.choices, required=False)
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    contract_number = serializers.CharField(source="contract.number", read_only=True)
    contract_title = serializers.CharField(source="contract.title", read_only=True)

    class Meta:
        model = ContractExpense
        fields = "__all__"
        read_only_fields = ["source", "position"]

    def create(self, validated_data):
        # вид не выбран — определяем по комментарию, как при загрузке из Excel
        if not validated_data.get("kind"):
            validated_data["kind"] = classify(validated_data.get("comment"))
        top = (ContractExpense.objects.filter(contract=validated_data["contract"])
               .aggregate(m=Max("position"))["m"] or 0)
        validated_data["position"] = top + 1
        return super().create(validated_data)


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


def contract_money(contract, user):
    """Деньги договора — только в той части, на которую у человека есть право:
    технолог видит реестр, но не видит оплат и расходов."""
    see_pay = can_read(user, "contracts.payments")
    see_exp = can_read(user, "contracts.expenses")
    paid = contract.paid_amount if see_pay else None
    spent = contract.expenses_total if see_exp else None
    return {
        "paid": _f(paid) if see_pay else None,
        "debt": _f(max(contract.amount - paid, Decimal(0))) if see_pay else None,
        "expenses": _f(spent) if see_exp else None,
        "profit": _f(contract.amount - spent) if see_exp else None,
        "balance": _f(paid - spent) if (see_pay and see_exp) else None,
    }


class ContractSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    manager_name = serializers.CharField(source="manager.username", read_only=True, default=None)
    own_company_name = serializers.CharField(source="own_company.name", read_only=True, default=None)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    is_overdue = serializers.BooleanField(read_only=True)
    money = serializers.SerializerMethodField()

    class Meta:
        model = Contract
        fields = "__all__"

    def get_money(self, obj):
        return contract_money(obj, _user(self.context))

    def validate_status(self, value):
        # При заведении договора статус любой: в систему вносят и те, что
        # давно в работе. У существующего — только по цепочке.
        if self.instance is None:
            return value
        err = self.instance.transition_error(value)
        if err:
            raise serializers.ValidationError(err)
        return value


class ContractDetailSerializer(ContractSerializer):
    """Договор целиком: деньги построчно, цех, файлы, комментарии, откуда пришёл."""
    payments = serializers.SerializerMethodField()
    expenses = serializers.SerializerMethodField()
    by_kind = serializers.SerializerMethodField()
    files = serializers.SerializerMethodField()
    comments = serializers.SerializerMethodField()
    allowed_transitions = serializers.SerializerMethodField()
    work_orders = serializers.SerializerMethodField()
    tender = serializers.SerializerMethodField()

    def _can(self, key):
        return can_read(_user(self.context), key)

    def get_payments(self, obj):
        if not self._can("contracts.payments"):
            return None
        return ContractPaymentSerializer(obj.payments.all(), many=True).data

    def get_expenses(self, obj):
        if not self._can("contracts.expenses"):
            return None
        return ContractExpenseSerializer(obj.expenses.all(), many=True).data

    def get_by_kind(self, obj):
        """Куда ушли деньги договора — по видам трат."""
        if not self._can("contracts.expenses"):
            return None
        rows = list(obj.expenses.all())
        total = sum((e.amount for e in rows), Decimal("0"))
        acc = {}
        for e in rows:
            acc[e.kind] = acc.get(e.kind, Decimal("0")) + e.amount
        labels = dict(ExpenseKind.choices)
        return [{"kind": k, "label": labels.get(k, k), "total": _f(v),
                 "share": round(float(v / total * 100), 1) if total else 0}
                for k, v in sorted(acc.items(), key=lambda kv: -kv[1])]

    def get_files(self, obj):
        if not self._can("contracts.files"):
            return None
        return ContractFileSerializer(obj.files.all(), many=True, context=self.context).data

    def get_comments(self, obj):
        if not self._can("contracts.comments"):
            return None
        return CommentSerializer(obj.comments.all(), many=True).data

    def get_allowed_transitions(self, obj):
        return sorted(map(str, Contract.TRANSITIONS.get(obj.status, set())))

    def get_work_orders(self, obj):
        """Заказы цеха по договору — с полосками по этапам, чтобы провалиться в цех."""
        if not self._can("workshop.orders"):
            return None
        from workshop.calc import with_details, order_summary
        return [{"id": o.id, "product": o.product, "status": o.status,
                 "status_display": o.get_status_display(), "deadline": o.deadline,
                 "summary": order_summary(o)}
                for o in with_details(obj.work_orders.all())]

    def get_tender(self, obj):
        t = getattr(obj, "tender", None) if hasattr(obj, "tender") else None
        if t is None or not self._can("tenders.tenders"):
            return None
        return {"id": t.id, "purchase_no": t.purchase_no, "lot_no": t.lot_no,
                "platform": t.platform.name if t.platform else "", "status": t.status}
