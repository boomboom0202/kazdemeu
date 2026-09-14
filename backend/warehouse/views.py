from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from accounts.permissions import RoleSectionPermission
from accounts.mixins import SafeDestroyMixin
from .goods import goods_lines
from .models import Supplier, Material, MaterialBatch, StockMovement, GoodsMovement, check_low_stock
from .serializers import (SupplierSerializer, MaterialSerializer, MaterialBatchSerializer,
                          StockMovementSerializer, GoodsMovementSerializer)


class Base(SafeDestroyMixin, viewsets.ModelViewSet):
    permission_classes = [RoleSectionPermission]
    section = "warehouse"


class SupplierViewSet(Base):
    access_key = "warehouse.suppliers"
    queryset = Supplier.objects.all().order_by("name")
    serializer_class = SupplierSerializer
    search_fields = ["name"]


class MaterialViewSet(Base):
    access_key = "warehouse.materials"
    queryset = Material.objects.select_related("default_supplier").prefetch_related("batches")
    serializer_class = MaterialSerializer
    search_fields = ["name", "sku"]

    @action(detail=False, methods=["post"])
    def check_stock(self, request):
        """Пройтись по материалам и напомнить уведомлением о тех, что заканчиваются."""
        low = 0
        for m in Material.objects.all():
            if m.min_stock and m.stock < m.min_stock:
                low += 1
                check_low_stock(m)
        return Response({"low": low})


class MaterialBatchViewSet(Base):
    access_key = "warehouse.receipts"
    queryset = MaterialBatch.objects.select_related("material", "supplier")
    serializer_class = MaterialBatchSerializer
    filterset_fields = ["material", "supplier"]
    http_method_names = ["get", "post", "head", "options"]

    @action(detail=True, methods=["post"])
    def reverse(self, request, pk=None):
        """Сторно прихода. Блокируется, если материал из партии уже выдан."""
        batch = self.get_object()
        if batch.material.stock - batch.qty < 0:
            return Response(
                {"detail": "Нельзя сторнировать: материал из этой партии уже выдан — "
                           "остаток стал бы отрицательным."}, status=400)
        StockMovement.objects.create(
            material=batch.material, qty=-batch.qty, reason=StockMovement.Reason.RETURN,
            note=f"Сторно прихода партии {batch.batch_no or batch.pk}", created_by=request.user)
        batch.delete()
        return Response({"status": "ok"})


class StockMovementViewSet(Base):
    access_key = "warehouse.issues"
    queryset = StockMovement.objects.select_related("material", "created_by", "work_order")
    serializer_class = StockMovementSerializer
    filterset_fields = ["material", "reason", "work_order"]
    http_method_names = ["get", "post", "head", "options"]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class GoodsMovementViewSet(Base):
    access_key = "warehouse.goods"
    queryset = GoodsMovement.objects.select_related("contract", "work_order", "created_by")
    serializer_class = GoodsMovementSerializer
    filterset_fields = ["kind", "contract", "work_order"]
    http_method_names = ["get", "post", "delete", "head", "options"]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=False, methods=["get"])
    def stock(self, request):
        """Остаток готовой продукции по заказам и размерам."""
        return Response(goods_lines())
