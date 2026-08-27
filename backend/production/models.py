import io
import base64
from decimal import Decimal
from django.db import models
from django.conf import settings


class Product(models.Model):
    """Готовое изделие. BOM — состав материалов (норма расхода на 1 шт.)."""
    name = models.CharField(max_length=255)
    sku = models.CharField(max_length=64, unique=True)
    base_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    labor_cost = models.DecimalField("Оплата труда на 1 шт. (переменный)", max_digits=12,
                                     decimal_places=2, default=0)
    norm_hours = models.DecimalField("Норма времени на 1 шт., ч", max_digits=8, decimal_places=2,
                                     default=0, help_text="Для распределения накладных по нормо-часам")
    overhead_cost = models.DecimalField(
        "Накладные на 1 шт. (ручное значение)", max_digits=12, decimal_places=2, default=0,
        help_text="Используется только если включено переопределение")
    overhead_override = models.BooleanField(
        "Задать накладные вручную", default=False,
        help_text="По умолчанию накладные считаются автоматически из постоянных расходов")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.sku})"

    @property
    def material_cost(self):
        return sum(i.qty * i.material.avg_price for i in self.bom_items.select_related("material"))

    @property
    def overhead(self):
        """Накладные на 1 шт.: вручную или автоматически из постоянных расходов.
        Постоянные расходы вводятся один раз и распределяются по методу из настроек."""
        if self.overhead_override:
            return self.overhead_cost
        from finance.models import CostSettings
        s = CostSettings.get_solo()
        rate = s.overhead_rate
        if s.method == CostSettings.Method.PER_HOUR:
            return Decimal(str(rate)) * (self.norm_hours or 0)
        return Decimal(str(rate))

    @property
    def cost_price(self):
        """Полная себестоимость 1 шт. = материалы + труд (переменные) + накладные (постоянные)."""
        return self.material_cost + self.labor_cost + self.overhead

    @property
    def margin(self):
        return self.base_price - self.cost_price

    @property
    def margin_percent(self):
        return float(self.margin / self.base_price * 100) if self.base_price else 0

    @property
    def fg_stock(self):
        agg = self.fg_movements.aggregate(s=models.Sum("qty"))
        return agg["s"] or 0

    def qr_base64(self):
        """QR-код с SKU (data-URI PNG)."""
        import qrcode
        img = qrcode.make(f"PRODUCT:{self.sku}")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


class BOMItem(models.Model):
    """Спецификация (Bill of Materials): расход материала на 1 изделие."""
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="bom_items")
    material = models.ForeignKey("warehouse.Material", on_delete=models.PROTECT)
    qty = models.DecimalField("Норма на 1 шт.", max_digits=12, decimal_places=3)

    class Meta:
        unique_together = ("product", "material")

    def __str__(self):
        return f"{self.product.sku}: {self.material.sku} × {self.qty}"


class PriceList(models.Model):
    """Прайс: разным клиентам — разные цены."""
    name = models.CharField(max_length=255)
    customer = models.ForeignKey("contracts.Customer", null=True, blank=True,
                                 on_delete=models.CASCADE, related_name="price_lists",
                                 help_text="Пусто = общий прайс")

    def __str__(self):
        return self.name


class PriceListItem(models.Model):
    price_list = models.ForeignKey(PriceList, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, on_delete=models.CASCADE)
    price = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        unique_together = ("price_list", "product")


class StageTemplate(models.Model):
    """Справочник этапов цеха — технолог создаёт маршрут с нуля.
    Порядок задаётся полем position."""
    code = models.SlugField("Код", max_length=32, unique=True)
    name = models.CharField("Название этапа", max_length=100)
    position = models.PositiveSmallIntegerField("Порядок", default=0)
    default_norm_hours = models.DecimalField("Норма часов по умолчанию", max_digits=8,
                                             decimal_places=2, default=0)
    is_active = models.BooleanField("Использовать в новых заказах", default=True)

    class Meta:
        ordering = ["position", "id"]
        verbose_name = "Этап производства"
        verbose_name_plural = "Этапы производства (конструктор)"

    def __str__(self):
        return self.name


DEFAULT_STAGES = [
    ("cutting", "Крой", 0), ("sewing", "Пошив", 1), ("finishing", "Отделка", 2),
    ("qc", "Контроль (ОТК)", 3), ("warehouse", "Сдача на склад", 4),
]


def ensure_default_stages():
    """Создаёт стандартный маршрут, если справочник пуст."""
    if not StageTemplate.objects.exists():
        for code, name, pos in DEFAULT_STAGES:
            StageTemplate.objects.get_or_create(code=code, defaults={"name": name, "position": pos})


class ProductRouteStage(models.Model):
    """Маршрут конкретного изделия: какие этапы и в каком порядке его проходят.

    Если у изделия нет ни одной записи, заказ собирается по общему справочнику
    (StageTemplate с галочкой «использовать в новых заказах») — так изделия,
    заведённые до появления маршрутов, продолжают работать как раньше.
    """
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="route")
    template = models.ForeignKey(StageTemplate, on_delete=models.PROTECT,
                                 related_name="in_routes", verbose_name="Этап")
    position = models.PositiveSmallIntegerField("Порядок", default=0)
    norm_hours = models.DecimalField("Норма часов на этап", max_digits=8, decimal_places=2,
                                     default=0,
                                     help_text="0 — взять норму из справочника этапов")

    class Meta:
        ordering = ["position", "id"]
        unique_together = ("product", "template")
        verbose_name = "Этап маршрута изделия"
        verbose_name_plural = "Маршрут изделия"

    def __str__(self):
        return f"{self.product.sku}: {self.position}. {self.template.name}"

    @property
    def effective_norm_hours(self):
        return self.norm_hours or self.template.default_norm_hours


class ProductionOrder(models.Model):
    """Производственный заказ: материалы → готовая продукция."""
    class Status(models.TextChoices):
        PLANNED = "planned", "Запланирован"
        IN_PROGRESS = "in_progress", "В работе"
        DONE = "done", "Завершён"
        CANCELLED = "cancelled", "Отменён"

    number = models.CharField(max_length=50, unique=True)
    contract = models.ForeignKey("contracts.Contract", null=True, blank=True,
                                 on_delete=models.SET_NULL, related_name="production_orders")
    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    qty = models.PositiveIntegerField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PLANNED)
    materials_written_off = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"ПЗ №{self.number}: {self.product.name} × {self.qty}"

    def create_stages(self):
        """Этапы заказа: сначала маршрут изделия, при его отсутствии — общий справочник."""
        ensure_default_stages()
        route = list(self.product.route.select_related("template").all())
        if route:
            plan = [(r.template.code, r.template.name, r.position, r.effective_norm_hours)
                    for r in route]
        else:
            plan = [(t.code, t.name, t.position, t.default_norm_hours)
                    for t in StageTemplate.objects.filter(is_active=True)]
        for code, name, position, norm_hours in plan:
            ProductionStage.objects.get_or_create(
                order=self, stage=code,
                defaults={"position": position, "name": name, "norm_hours": norm_hours})

    def write_off_materials(self):
        """Автосписание материалов по BOM при запуске заказа."""
        from warehouse.models import StockMovement
        if self.materials_written_off:
            return
        for item in self.product.bom_items.select_related("material"):
            StockMovement.objects.create(
                material=item.material,
                qty=-(item.qty * self.qty),
                reason=StockMovement.Reason.PRODUCTION,
                note=f"ПЗ №{self.number}",
            )
        self.materials_written_off = True
        self.save(update_fields=["materials_written_off"])

    def finish(self):
        """Приход готовой продукции на склад при завершении."""
        from warehouse.models import FinishedGoodsMovement
        FinishedGoodsMovement.objects.create(
            product=self.product, qty=self.qty,
            contract=self.contract, note=f"ПЗ №{self.number} завершён",
        )
        self.status = self.Status.DONE
        self.save(update_fields=["status"])


class ProductionStage(models.Model):
    """Этап: заказ → крой → пошив → отделка → ОТК → склад."""
    class Status(models.TextChoices):
        PENDING = "pending", "Ожидает"
        IN_PROGRESS = "in_progress", "В работе"
        DONE = "done", "Готово"

    order = models.ForeignKey(ProductionOrder, on_delete=models.CASCADE, related_name="stages")
    stage = models.CharField("Код этапа", max_length=32)
    name = models.CharField("Название этапа", max_length=100, blank=True)
    position = models.PositiveSmallIntegerField(default=0)
    assignee = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                 on_delete=models.SET_NULL, related_name="stages")
    norm_hours = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    actual_hours = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["order", "position"]
        unique_together = ("order", "stage")

    @property
    def label(self):
        return self.name or self.stage

    def __str__(self):
        return f"{self.order.number} / {self.label}"
