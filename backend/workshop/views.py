from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from accounts.permissions import RoleSectionPermission
from accounts.mixins import SafeDestroyMixin
from .calc import with_details, parse_sizes, apply_sizes
from .models import (Brigade, WorkOrder, WorkSize, CutEntry, EmbroideryEntry, SewingJob,
                     SewingProgress, PackEntry)
from .serializers import (BrigadeSerializer, WorkOrderSerializer, WorkOrderDetailSerializer,
                          WorkSizeSerializer, CutEntrySerializer, EmbroideryEntrySerializer,
                          SewingJobSerializer, SewingProgressSerializer, PackEntrySerializer)

# Записи цеха — факты: их не правят, а удаляют ошибочную и вносят заново.
# Так в истории не бывает тихо переписанных цифр.
FACTS_ONLY = ["get", "post", "delete", "head", "options"]


class Base(SafeDestroyMixin, viewsets.ModelViewSet):
    permission_classes = [RoleSectionPermission]
    section = "workshop"


class BrigadeViewSet(Base):
    access_key = "workshop.sewing"
    queryset = Brigade.objects.prefetch_related("jobs__progress", "jobs__size__order")
    serializer_class = BrigadeSerializer
    search_fields = ["leader"]


class WorkOrderViewSet(Base):
    access_key = "workshop.orders"
    queryset = with_details(WorkOrder.objects.select_related("contract"))
    filterset_fields = ["status", "contract"]
    search_fields = ["product", "client", "contract__number"]

    def get_serializer_class(self):
        if self.action in ("retrieve", "sizes_bulk", "set_status"):
            return WorkOrderDetailSerializer
        return WorkOrderSerializer

    def _detail(self, order):
        order = with_details(WorkOrder.objects.select_related("contract")).get(pk=order.pk)
        return WorkOrderDetailSerializer(order, context=self.get_serializer_context()).data

    @action(detail=True, methods=["post"])
    def sizes_bulk(self, request, pk=None):
        """Добавить размеры столбиком. Всё или ничего: при ошибке в строке
        не добавляется ни один размер, чтобы не собирать сетку по кускам."""
        order = self.get_object()
        rows, errors = parse_sizes(request.data.get("text", ""))
        if errors:
            return Response({"detail": "\n".join(errors)}, status=status.HTTP_400_BAD_REQUEST)
        if not rows:
            return Response({"detail": "Не указано ни одного размера."},
                            status=status.HTTP_400_BAD_REQUEST)
        added, updated = apply_sizes(order, rows)
        data = self._detail(order)
        data["report"] = {"added": added, "updated": updated}
        return Response(data)

    @action(detail=True, methods=["post"])
    def set_status(self, request, pk=None):
        order = self.get_object()
        new = request.data.get("status")
        if new not in dict(WorkOrder.Status.choices):
            return Response({"detail": "Неизвестный статус."}, status=status.HTTP_400_BAD_REQUEST)
        order.status = new
        order.save(update_fields=["status"])
        return Response(self._detail(order))


class WorkSizeViewSet(Base):
    access_key = "workshop.orders"
    queryset = WorkSize.objects.select_related("order")
    serializer_class = WorkSizeSerializer
    filterset_fields = ["order"]


class CutEntryViewSet(Base):
    access_key = "workshop.cutting"
    http_method_names = FACTS_ONLY
    queryset = CutEntry.objects.select_related("size__order").prefetch_related("materials")
    serializer_class = CutEntrySerializer
    filterset_fields = ["size", "size__order"]


class EmbroideryEntryViewSet(Base):
    access_key = "workshop.cutting"
    http_method_names = FACTS_ONLY
    queryset = EmbroideryEntry.objects.select_related("size__order")
    serializer_class = EmbroideryEntrySerializer
    filterset_fields = ["size", "size__order"]


class SewingJobViewSet(Base):
    access_key = "workshop.sewing"
    http_method_names = FACTS_ONLY
    queryset = SewingJob.objects.select_related("brigade", "size__order").prefetch_related("progress")
    serializer_class = SewingJobSerializer
    filterset_fields = ["size", "size__order", "brigade"]

    @action(detail=True, methods=["post"])
    def progress(self, request, pk=None):
        """Отметить готовность партии на дату: доля от 0 до 1, 1 — «на упаковке»."""
        job = self.get_object()
        s = SewingProgressSerializer(data={**request.data, "job": job.pk})
        s.is_valid(raise_exception=True)
        s.save()
        job = SewingJob.objects.select_related("brigade").prefetch_related("progress").get(pk=job.pk)
        return Response(SewingJobSerializer(job).data)


class SewingProgressViewSet(Base):
    access_key = "workshop.sewing"
    http_method_names = ["get", "delete", "head", "options"]
    queryset = SewingProgress.objects.select_related("job")
    serializer_class = SewingProgressSerializer
    filterset_fields = ["job"]


class PackEntryViewSet(Base):
    access_key = "workshop.packing"
    http_method_names = FACTS_ONLY
    queryset = PackEntry.objects.select_related("size__order")
    serializer_class = PackEntrySerializer
    filterset_fields = ["size", "size__order"]
