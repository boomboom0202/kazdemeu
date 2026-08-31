import io
from datetime import datetime
from django.http import HttpResponse
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from accounts.permissions import RoleSectionPermission
from accounts.mixins import SafeDestroyMixin
from .models import Customer, Contract, PaymentScheduleItem, ContractFile, Comment
from .serializers import (CustomerSerializer, ContractSerializer, ContractDetailSerializer,
                          PaymentScheduleItemSerializer, ContractFileSerializer, CommentSerializer)

EXPORT_HEADERS = ["number", "customer", "title", "status", "amount",
                  "signed_date", "deadline", "specification"]


class CustomerViewSet(SafeDestroyMixin, viewsets.ModelViewSet):
    access_key = "contracts.customers"
    queryset = Customer.objects.all().order_by("name")
    serializer_class = CustomerSerializer
    permission_classes = [RoleSectionPermission]
    section = "contracts"
    search_fields = ["name", "bin_iin", "phone"]


class ContractViewSet(SafeDestroyMixin, viewsets.ModelViewSet):
    access_key = "contracts.contracts"
    queryset = Contract.objects.select_related("customer", "manager")
    permission_classes = [RoleSectionPermission]
    section = "contracts"
    filterset_fields = ["status", "customer", "manager"]
    search_fields = ["number", "title", "customer__name"]

    def get_serializer_class(self):
        return ContractDetailSerializer if self.action == "retrieve" else ContractSerializer

    @action(detail=True, methods=["post"])
    def set_status(self, request, pk=None):
        """Смена статуса строго по цепочке: new → negotiation → in_progress → closed/cancelled."""
        contract = self.get_object()
        new_status = request.data.get("status")
        if new_status not in dict(Contract.Status.choices):
            return Response({"detail": "Неизвестный статус договора."},
                            status=status.HTTP_400_BAD_REQUEST)
        err = contract.transition_error(new_status)
        if err:
            return Response({"detail": err}, status=status.HTTP_400_BAD_REQUEST)
        contract.status = new_status
        contract.save(update_fields=["status", "updated_at"])
        return Response(ContractDetailSerializer(contract).data)

    @action(detail=False, methods=["get"])
    def export_excel(self, request):
        """Выгрузка договоров в Excel для отчётности."""
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.title = "Договоры"
        ws.append(EXPORT_HEADERS + ["paid_amount"])
        for c in self.filter_queryset(self.get_queryset()):
            ws.append([c.number, c.customer.name, c.title, c.status, float(c.amount),
                       str(c.signed_date or ""), str(c.deadline or ""),
                       c.specification, float(c.paid_amount)])
        buf = io.BytesIO()
        wb.save(buf)
        resp = HttpResponse(buf.getvalue(),
                            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        resp["Content-Disposition"] = 'attachment; filename="contracts.xlsx"'
        return resp

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser])
    def import_excel(self, request):
        """Массовая загрузка: колонки number, customer, title, status, amount, signed_date, deadline, specification."""
        from openpyxl import load_workbook
        file = request.FILES.get("file")
        if not file:
            return Response({"detail": "Файл не передан (поле file)."}, status=400)
        wb = load_workbook(file, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        header = [str(h).strip().lower() if h else "" for h in rows[0]]
        created, updated, errors = 0, 0, []
        for i, row in enumerate(rows[1:], start=2):
            data = dict(zip(header, row))
            try:
                number = str(data.get("number") or "").strip()
                if not number:
                    continue
                customer, _ = Customer.objects.get_or_create(name=str(data.get("customer") or "Без имени").strip())
                defaults = {
                    "customer": customer,
                    "title": str(data.get("title") or "")[:255],
                    "amount": data.get("amount") or 0,
                    "specification": str(data.get("specification") or ""),
                }
                st = str(data.get("status") or "").strip()
                if st in dict(Contract.Status.choices):
                    defaults["status"] = st
                for f in ("signed_date", "deadline"):
                    v = data.get(f)
                    if isinstance(v, datetime):
                        defaults[f] = v.date()
                    elif isinstance(v, str) and v.strip():
                        defaults[f] = datetime.strptime(v.strip()[:10], "%Y-%m-%d").date()
                _, was_created = Contract.objects.update_or_create(number=number, defaults=defaults)
                created += was_created
                updated += (not was_created)
            except Exception as e:
                errors.append(f"строка {i}: {e}")
        return Response({"created": created, "updated": updated, "errors": errors})


class PaymentScheduleViewSet(SafeDestroyMixin, viewsets.ModelViewSet):
    access_key = "contracts.schedule"
    queryset = PaymentScheduleItem.objects.select_related("contract")
    serializer_class = PaymentScheduleItemSerializer
    permission_classes = [RoleSectionPermission]
    section = "contracts"
    filterset_fields = ["contract"]

    def _register_cash(self, item, delta):
        """Оплата по графику автоматически попадает в кассу (Cash Flow)."""
        from django.utils import timezone
        from finance.models import CashEntry
        if delta > 0:
            CashEntry.objects.create(
                direction="in", amount=delta,
                date=item.paid_date or timezone.localdate(),
                contract=item.contract,
                description=f"Оплата по графику, договор №{item.contract.number}")

    def perform_create(self, serializer):
        item = serializer.save()
        self._register_cash(item, item.paid_amount)

    def perform_update(self, serializer):
        old_paid = serializer.instance.paid_amount
        item = serializer.save()
        self._register_cash(item, item.paid_amount - old_paid)


class ContractFileViewSet(SafeDestroyMixin, viewsets.ModelViewSet):
    access_key = "contracts.files"
    queryset = ContractFile.objects.all()
    serializer_class = ContractFileSerializer
    permission_classes = [RoleSectionPermission]
    section = "contracts"
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    filterset_fields = ["contract", "kind"]

    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)


class CommentViewSet(SafeDestroyMixin, viewsets.ModelViewSet):
    access_key = "contracts.comments"
    queryset = Comment.objects.select_related("author", "contract")
    serializer_class = CommentSerializer
    permission_classes = [RoleSectionPermission]
    section = "contracts"
    filterset_fields = ["contract", "importance"]

    def perform_create(self, serializer):
        serializer.save(author=self.request.user)
