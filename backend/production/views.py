from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.utils import timezone
from accounts.permissions import RoleSectionPermission
from accounts.mixins import SafeDestroyMixin
from .models import (Product, BOMItem, PriceList, PriceListItem,
                     ProductionOrder, ProductionStage, StageTemplate,
                     ProductRouteStage, ensure_default_stages)
from .serializers import (ProductSerializer, ProductDetailSerializer, BOMItemSerializer,
                          PriceListSerializer, PriceListItemSerializer,
                          ProductionOrderSerializer, ProductionStageSerializer,
                          StageTemplateSerializer, ProductRouteStageSerializer)


class CatalogBase(SafeDestroyMixin, viewsets.ModelViewSet):
    permission_classes = [RoleSectionPermission]
    section = "catalog"


class ProdBase(SafeDestroyMixin, viewsets.ModelViewSet):
    permission_classes = [RoleSectionPermission]
    section = "production"


class ProductViewSet(CatalogBase):
    queryset = Product.objects.all().order_by("name")
    search_fields = ["name", "sku"]

    def get_serializer_class(self):
        return ProductDetailSerializer if self.action == "retrieve" else ProductSerializer

    @action(detail=True, methods=["post"])
    def route_from_default(self, request, pk=None):
        """Заполнить маршрут изделия стандартным набором этапов.

        Нужно, чтобы технолог не добавлял пять этапов руками каждому изделию:
        берётся общий справочник, дальше маршрут правится точечно.
        Уже добавленные этапы не дублируются.
        """
        product = self.get_object()
        ensure_default_stages()
        added = 0
        for tpl in StageTemplate.objects.filter(is_active=True):
            _, created = ProductRouteStage.objects.get_or_create(
                product=product, template=tpl,
                defaults={"position": tpl.position, "norm_hours": tpl.default_norm_hours})
            added += created
        return Response(ProductDetailSerializer(product).data)

    @action(detail=True, methods=["post"])
    def reorder_route(self, request, pk=None):
        """Переставить этапы маршрута: принимает список id в нужном порядке.

        Перенумеровывается всё разом, одним запросом — иначе при обрыве связи
        маршрут остался бы с двумя одинаковыми позициями.
        """
        product = self.get_object()
        ids = request.data.get("order") or []
        rows = {r.id: r for r in product.route.all()}
        if len(ids) != len(rows) or set(ids) != set(rows):
            return Response(
                {"detail": "Нужен список всех этапов маршрута, каждый ровно один раз."},
                status=400)
        for position, rid in enumerate(ids):
            row = rows[rid]
            if row.position != position:
                row.position = position
                row.save(update_fields=["position"])
        return Response(ProductDetailSerializer(product).data)

    @action(detail=True, methods=["get"])
    def bom_check(self, request, pk=None):
        """Хватит ли материалов на qty штук (по умолчанию 1)."""
        product = self.get_object()
        qty = int(request.query_params.get("qty", 1))
        rows = []
        for item in product.bom_items.select_related("material"):
            need = item.qty * qty
            have = item.material.stock
            rows.append({
                "material": item.material.name, "unit": item.material.unit,
                "need": float(need), "have": float(have), "enough": have >= need,
            })
        return Response({"qty": qty, "items": rows, "all_enough": all(r["enough"] for r in rows)})


class StageTemplateViewSet(CatalogBase):
    """Конструктор этапов цеха: технолог создаёт/удаляет/переупорядочивает этапы."""
    queryset = StageTemplate.objects.all()
    serializer_class = StageTemplateSerializer


class ProductRouteStageViewSet(CatalogBase):
    """Маршрут изделия: какие этапы и в каком порядке оно проходит."""
    queryset = ProductRouteStage.objects.select_related("product", "template")
    serializer_class = ProductRouteStageSerializer
    filterset_fields = ["product"]


class BOMItemViewSet(CatalogBase):
    queryset = BOMItem.objects.select_related("product", "material")
    serializer_class = BOMItemSerializer
    filterset_fields = ["product"]


class PriceListViewSet(CatalogBase):
    queryset = PriceList.objects.prefetch_related("items")
    serializer_class = PriceListSerializer
    filterset_fields = ["customer"]


class PriceListItemViewSet(CatalogBase):
    queryset = PriceListItem.objects.select_related("product")
    serializer_class = PriceListItemSerializer
    filterset_fields = ["price_list"]


class ProductionOrderViewSet(ProdBase):
    queryset = ProductionOrder.objects.select_related("product", "contract").prefetch_related("stages")
    serializer_class = ProductionOrderSerializer
    filterset_fields = ["status", "contract", "product"]
    search_fields = ["number"]

    def perform_create(self, serializer):
        order = serializer.save()
        order.create_stages()

    def destroy(self, request, *args, **kwargs):
        order = self.get_object()
        if order.status != ProductionOrder.Status.PLANNED:
            return Response(
                {"detail": "Удалять можно только запланированный заказ. Запущенный/завершённый "
                           "заказ уже двигал склад — удаление исказит остатки."},
                status=400)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        """Запуск: проверяет достаточность материалов, списывает их по BOM, статус в работу."""
        order = self.get_object()
        if order.status != ProductionOrder.Status.PLANNED:
            return Response({"detail": "Заказ уже запущен или завершён."}, status=400)
        shortages = []
        for item in order.product.bom_items.select_related("material"):
            need = item.qty * order.qty
            have = item.material.stock
            if have < need:
                shortages.append(f"{item.material.name}: нужно {need} {item.material.unit}, на складе {have}")
        if shortages:
            return Response({"detail": "Недостаточно материалов на складе:\n" + "\n".join(shortages)}, status=400)
        order.write_off_materials()
        order.status = ProductionOrder.Status.IN_PROGRESS
        order.save(update_fields=["status"])
        return Response(ProductionOrderSerializer(order).data)

    @action(detail=True, methods=["post"])
    def finish(self, request, pk=None):
        """Завершение: все этапы должны быть готовы, затем приход готовой продукции на склад."""
        order = self.get_object()
        if order.status != ProductionOrder.Status.IN_PROGRESS:
            return Response({"detail": "Заказ не в работе."}, status=400)
        not_done = [s.label for s in order.stages.exclude(status="done")]
        if not_done:
            return Response({"detail": "Сначала завершите этапы: " + ", ".join(not_done)}, status=400)
        order.finish()
        return Response(ProductionOrderSerializer(order).data)


class ProductionStageViewSet(ProdBase):
    queryset = ProductionStage.objects.select_related("order", "assignee")
    serializer_class = ProductionStageSerializer
    filterset_fields = ["order", "stage", "status", "assignee"]

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        st = self.get_object()
        st.status = ProductionStage.Status.IN_PROGRESS
        st.started_at = timezone.now()
        st.save()
        return Response(ProductionStageSerializer(st).data)

    @action(detail=True, methods=["post"])
    def done(self, request, pk=None):
        st = self.get_object()
        st.status = ProductionStage.Status.DONE
        st.finished_at = timezone.now()
        if st.started_at and not request.data.get("actual_hours"):
            st.actual_hours = round((st.finished_at - st.started_at).total_seconds() / 3600, 2)
        elif request.data.get("actual_hours"):
            st.actual_hours = request.data["actual_hours"]
        st.save()
        return Response(ProductionStageSerializer(st).data)
