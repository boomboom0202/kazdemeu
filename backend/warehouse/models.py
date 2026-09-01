from decimal import Decimal
from django.core.validators import MinValueValidator
from django.db import models
from django.conf import settings

# Количество и деньги не бывают отрицательными. У движений по складу знак
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
    """Сырьё/материал. min_stock — порог для авто-заявки поставщику."""
    name = models.CharField(max_length=255)
    sku = models.CharField(max_length=64, unique=True)
    unit = models.CharField(max_length=20, default="м")  # м, кг, шт...
    min_stock = models.DecimalField(max_digits=12, decimal_places=3, default=0,
                                    validators=NON_NEGATIVE)
    default_supplier = models.ForeignKey(Supplier, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.sku})"

    @property
    def stock(self):
        """Текущий остаток = приходы − расходы."""
        agg = self.movements.aggregate(s=models.Sum("qty"))
        return agg["s"] or 0

    @property
    def avg_price(self):
        """Средневзвешенная цена по партиям (для себестоимости)."""
        batches = self.batches.all()
        total_qty = sum(b.qty for b in batches)
        if not total_qty:
            return 0
        return sum(b.qty * b.unit_price for b in batches) / total_qty


class MaterialBatch(models.Model):
    """Партия: учёт по поставщикам и партиям."""
    material = models.ForeignKey(Material, on_delete=models.CASCADE, related_name="batches")
    # История приёмки — учётные данные: от кого принято, по какой цене.
    # При SET_NULL удаление поставщика молча стирало происхождение партий,
    # хотя заявки на закуп его уже защищали. Теперь правило одно.
    supplier = models.ForeignKey(Supplier, null=True, blank=True, on_delete=models.PROTECT)
    batch_no = models.CharField(max_length=64, blank=True)
    qty = models.DecimalField(max_digits=12, decimal_places=3, validators=POSITIVE_QTY)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, validators=NON_NEGATIVE)
    received_at = models.DateField()

    class Meta:
        ordering = ["-received_at", "-id"]

    def __str__(self):
        return f"{self.material.sku} партия {self.batch_no or self.pk}"

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
        PURCHASE = "purchase", "Закуп"
        PRODUCTION = "production", "Списание в производство"
        ADJUSTMENT = "adjustment", "Корректировка/инвентаризация"
        RETURN = "return", "Возврат"

    material = models.ForeignKey(Material, on_delete=models.CASCADE, related_name="movements")
    batch = models.ForeignKey(MaterialBatch, null=True, blank=True, on_delete=models.SET_NULL)
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
            self.material and check_low_stock(self.material)


class FinishedGoodsMovement(models.Model):
    """Остатки готовой продукции: qty > 0 сдача на склад, qty < 0 отгрузка."""
    product = models.ForeignKey("production.Product", on_delete=models.CASCADE, related_name="fg_movements")
    qty = models.IntegerField()
    note = models.CharField(max_length=255, blank=True)
    contract = models.ForeignKey("contracts.Contract", null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class PurchaseOrder(models.Model):
    """Заявка поставщику (в т.ч. автоматическая при низком остатке)."""
    class Status(models.TextChoices):
        DRAFT = "draft", "Черновик"
        SENT = "sent", "Отправлена"
        RECEIVED = "received", "Получена"
        CANCELLED = "cancelled", "Отменена"

    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="purchase_orders")
    material = models.ForeignKey(Material, on_delete=models.PROTECT)
    qty = models.DecimalField(max_digits=12, decimal_places=3, validators=POSITIVE_QTY)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    auto_created = models.BooleanField(default=False)
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


def check_low_stock(material: Material):
    """Если остаток ниже минимума — уведомление + авто-заявка поставщику."""
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
        if material.default_supplier:
            exists = PurchaseOrder.objects.filter(
                material=material, status__in=["draft", "sent"], auto_created=True
            ).exists()
            if not exists:
                PurchaseOrder.objects.create(
                    supplier=material.default_supplier, material=material,
                    qty=max(material.min_stock * 2 - material.stock, 0),
                    auto_created=True, note="Авто-заявка: остаток ниже минимума",
                )
