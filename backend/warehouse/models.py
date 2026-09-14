"""Склад: материалы (ткань, фурнитура) и готовая продукция.

Материалы приходят партиями от поставщиков и выдаются в цех под заказ.
Готовая продукция — то, что прошло последний этап заказа цеха: она
появляется на складе сама, без отдельной записи. Руками вносится только
остаток при переходе на систему и отгрузка заказчику.
"""
from decimal import Decimal
from django.core.validators import MinValueValidator
from django.db import models
from django.conf import settings
from django.utils import timezone

# Количество и деньги не бывают отрицательными. У движений материалов знак
# осмыслен (плюс — приход, минус — расход), поэтому их это не касается.
POSITIVE_QTY = [MinValueValidator(Decimal("0.001"))]
NON_NEGATIVE = [MinValueValidator(Decimal("0"))]


class Supplier(models.Model):
    name = models.CharField(max_length=255)
    bin_iin = models.CharField(max_length=12, blank=True)
    phone = models.CharField(max_length=32, blank=True)
    email = models.EmailField(blank=True)
    note = models.TextField(blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Material(models.Model):
    """Материал. min_stock — порог, ниже которого приходит уведомление."""
    name = models.CharField("Название", max_length=255)
    sku = models.CharField("Артикул", max_length=64, blank=True)
    unit = models.CharField("Ед. изм.", max_length=20, default="м")
    min_stock = models.DecimalField("Мин. остаток", max_digits=12, decimal_places=3, default=0,
                                    validators=NON_NEGATIVE)
    default_supplier = models.ForeignKey(Supplier, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    @property
    def stock(self):
        """Текущий остаток = приходы − расходы."""
        agg = self.movements.aggregate(s=models.Sum("qty"))
        return agg["s"] or 0

    @property
    def avg_price(self):
        """Средневзвешенная цена по партиям."""
        batches = self.batches.all()
        total_qty = sum(b.qty for b in batches)
        if not total_qty:
            return 0
        return sum(b.qty * b.unit_price for b in batches) / total_qty


class MaterialBatch(models.Model):
    """Приход материала партией: от кого, сколько, по какой цене."""
    material = models.ForeignKey(Material, on_delete=models.CASCADE, related_name="batches")
    supplier = models.ForeignKey(Supplier, null=True, blank=True, on_delete=models.PROTECT)
    batch_no = models.CharField(max_length=64, blank=True)
    qty = models.DecimalField(max_digits=12, decimal_places=3, validators=POSITIVE_QTY)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, validators=NON_NEGATIVE)
    received_at = models.DateField()

    class Meta:
        ordering = ["-received_at", "-id"]

    def __str__(self):
        return f"{self.material.name} партия {self.batch_no or self.pk}"

    def save(self, *args, **kwargs):
        created = self.pk is None
        super().save(*args, **kwargs)
        if created:
            StockMovement.objects.create(
                material=self.material, qty=self.qty,
                reason=StockMovement.Reason.PURCHASE, batch=self,
                note=f"Приход партии {self.batch_no or self.pk}",
            )


class StockMovement(models.Model):
    """Движение материала: qty > 0 приход, qty < 0 расход."""
    class Reason(models.TextChoices):
        PURCHASE = "purchase", "Приход партии"
        PRODUCTION = "production", "Выдача в цех"
        ADJUSTMENT = "adjustment", "Корректировка / инвентаризация"
        RETURN = "return", "Возврат"

    material = models.ForeignKey(Material, on_delete=models.CASCADE, related_name="movements")
    batch = models.ForeignKey(MaterialBatch, null=True, blank=True, on_delete=models.SET_NULL)
    work_order = models.ForeignKey("workshop.WorkOrder", null=True, blank=True,
                                   on_delete=models.SET_NULL, related_name="material_movements",
                                   verbose_name="Заказ цеха")
    qty = models.DecimalField(max_digits=12, decimal_places=3)
    reason = models.CharField(max_length=20, choices=Reason.choices)
    note = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        created = self.pk is None
        super().save(*args, **kwargs)
        if created and self.qty < 0:
            check_low_stock(self.material)


class GoodsMovement(models.Model):
    """Готовая продукция, внесённая руками: остаток при переходе на систему
    (приход) и отгрузка заказчику. Выпуск цеха сюда не пишется — он
    считается по последнему этапу заказа."""
    class Kind(models.TextChoices):
        IN = "in", "Приход"
        OUT = "out", "Отгрузка"

    kind = models.CharField(max_length=3, choices=Kind.choices)
    date = models.DateField("Дата", default=timezone.localdate)
    product = models.CharField("Изделие", max_length=150)
    size = models.CharField("Размер", max_length=40, blank=True)
    qty = models.PositiveIntegerField("Штук", validators=[MinValueValidator(1)])
    work_order = models.ForeignKey("workshop.WorkOrder", null=True, blank=True,
                                   on_delete=models.SET_NULL, related_name="goods_movements")
    contract = models.ForeignKey("contracts.Contract", null=True, blank=True,
                                 on_delete=models.SET_NULL, related_name="goods_movements")
    note = models.CharField("Примечание", max_length=255, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                   on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-id"]


def check_low_stock(material: Material):
    """Если остаток ниже минимума — уведомление."""
    if material.min_stock and material.stock < material.min_stock:
        from accounts.models import Notification
        Notification.objects.get_or_create(
            title=f"Низкий остаток: {material.name}",
            defaults=dict(
                level=Notification.Level.WARNING,
                message=f"Остаток {material.stock} {material.unit}, минимум {material.min_stock} {material.unit}.",
                link="/warehouse",
            ),
        )
