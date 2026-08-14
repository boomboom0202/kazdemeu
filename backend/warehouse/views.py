from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from accounts.permissions import RoleSectionPermission
from accounts.mixins import SafeDestroyMixin
from .models import (Supplier, Material, MaterialBatch, StockMovement,
                     FinishedGoodsMovement, PurchaseOrder, check_low_stock)
from .serializers import (SupplierSerializer, MaterialSerializer, MaterialBatchSerializer,
                          StockMovementSerializer, FinishedGoodsMovementSerializer,
                          PurchaseOrderSerializer)


class Base(SafeDestroyMixin, viewsets.ModelViewSet):
    permission_classes = [RoleSectionPermission]
    section = "warehouse"


class SupplierViewSet(Base):
    queryset = Supplier.objects.all().order_by("name")
    serializer_class = SupplierSerializer
    search_fields = ["name"]


class MaterialViewSet(Base):
    queryset = Material.objects.select_related("default_supplier")
    serializer_class = MaterialSerializer
    search_fields = ["name", "sku"]

    @action(detail=False, methods=["post"])
    def check_stock(self, request):
        """Пройтись по всем материалам, создать уведомления/авто-заявки."""
        for m in Material.objects.all():
            check_low_stock(m)
        return Response({"status": "ok"})


class MaterialBatchViewSet(Base):
    queryset = MaterialBatch.objects.select_related("material", "supplier")
    serializer_class = MaterialBatchSerializer
    filterset_fields = ["material", "supplier"]

    @action(detail=True, methods=["post"])
    def reverse(self, request, pk=None):
        """Сторно прихода: возвращает остаток и среднюю цену к состоянию до партии.
        Блокируется, если материал уже израсходован (остаток стал бы отрицательным)."""
        batch = self.get_object()
        if batch.material.stock - batch.qty < 0:
            return Response(
                {"detail": "Нельзя сторнировать: материал из этой партии уже израсходован — "
                           "остаток стал бы отрицательным."},
                status=400)
        StockMovement.objects.create(
            material=batch.material, qty=-batch.qty,
            reason=StockMovement.Reason.RETURN,
            note=f"Сторно прихода партии {batch.batch_no or batch.pk}",
        )
        batch.delete()
        return Response({"status": "ok"})


class StockMovementViewSet(Base):
    queryset = StockMovement.objects.select_related("material")
    serializer_class = StockMovementSerializer
    filterset_fields = ["material", "reason"]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class FinishedGoodsViewSet(Base):
    queryset = FinishedGoodsMovement.objects.select_related("product")
    serializer_class = FinishedGoodsMovementSerializer
    filterset_fields = ["product", "contract"]


class PurchaseOrderViewSet(Base):
    queryset = PurchaseOrder.objects.select_related("supplier", "material")
    serializer_class = PurchaseOrderSerializer
    filterset_fields = ["status", "supplier", "auto_created"]

    @action(detail=True, methods=["post"])
    def receive(self, request, pk=None):
        """Приёмка заявки: создаёт партию и приход на склад."""
        po = self.get_object()
        price = request.data.get("unit_price") or 0
        MaterialBatch.objects.create(
            material=po.material, supplier=po.supplier, qty=po.qty,
            unit_price=price, received_at=request.data.get("received_at") or __import__("datetime").date.today(),
            batch_no=request.data.get("batch_no", ""),
        )
        po.status = PurchaseOrder.Status.RECEIVED
        po.save(update_fields=["status"])
        return Response(PurchaseOrderSerializer(po).data)
