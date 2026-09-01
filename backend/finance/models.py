from decimal import Decimal
from django.core.validators import MinValueValidator
from django.db import models

POSITIVE_MONEY = [MinValueValidator(Decimal("0.01"))]
NON_NEGATIVE = [MinValueValidator(Decimal("0"))]


class ExpenseCategory(models.Model):
    class Kind(models.TextChoices):
        FIXED = "fixed", "Постоянные"
        VARIABLE = "variable", "Переменные"

    name = models.CharField(max_length=100, unique=True)
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.VARIABLE)

    def __str__(self):
        return self.name


class CashEntry(models.Model):
    """Движение денег: реальный кэш-флоу (поступления/расходы)."""
    class Direction(models.TextChoices):
        IN = "in", "Поступление"
        OUT = "out", "Расход"

    direction = models.CharField(max_length=3, choices=Direction.choices)
    amount = models.DecimalField(max_digits=14, decimal_places=2, validators=POSITIVE_MONEY)
    date = models.DateField()
    category = models.ForeignKey(ExpenseCategory, null=True, blank=True, on_delete=models.SET_NULL,
                                 help_text="Для расходов: материал, зарплата, аренда...")
    contract = models.ForeignKey("contracts.Contract", null=True, blank=True,
                                 on_delete=models.SET_NULL, related_name="cash_entries")
    description = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-created_at"]
        verbose_name_plural = "Cash entries"

    def __str__(self):
        sign = "+" if self.direction == "in" else "−"
        return f"{sign}{self.amount} ({self.date})"


class FixedCost(models.Model):
    """Постоянный расход — вводится ОДИН РАЗ (аренда, оклады АУП, интернет...).
    Действует ежемесячно, пока не отключён. Участвует в себестоимости
    через распределение, см. CostSettings."""
    name = models.CharField("Наименование", max_length=150)
    monthly_amount = models.DecimalField("Сумма в месяц, ₸", max_digits=14, decimal_places=2,
                                        validators=NON_NEGATIVE)
    category = models.ForeignKey(ExpenseCategory, null=True, blank=True, on_delete=models.SET_NULL)
    is_active = models.BooleanField("Действует", default=True)
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-is_active", "name"]
        verbose_name = "Постоянный расход"
        verbose_name_plural = "Постоянные расходы"

    def __str__(self):
        return f"{self.name}: {self.monthly_amount} ₸/мес"


class CostSettings(models.Model):
    """Единые настройки расчёта себестоимости (одна запись на систему).
    Постоянные расходы распределяются на изделия автоматически."""
    class Method(models.TextChoices):
        PER_HOUR = "per_hour", "На нормо-час (точнее)"
        PER_UNIT = "per_unit", "На единицу продукции (проще)"

    method = models.CharField("Метод распределения", max_length=10,
                              choices=Method.choices, default=Method.PER_HOUR)
    planned_monthly_units = models.PositiveIntegerField(
        "Плановый выпуск, шт/мес", default=1000, validators=[MinValueValidator(1)],
        help_text="Для метода «на единицу»")
    planned_monthly_hours = models.DecimalField(
        "Плановый фонд рабочего времени, ч/мес", max_digits=10, decimal_places=2, default=1000,
        validators=[MinValueValidator(Decimal("0.01"))],
        help_text="Для метода «на нормо-час»")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Настройки себестоимости"
        verbose_name_plural = "Настройки себестоимости"

    def save(self, *args, **kwargs):
        self.pk = 1  # singleton
        super().save(*args, **kwargs)

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    @property
    def monthly_fixed_total(self):
        agg = FixedCost.objects.filter(is_active=True).aggregate(s=models.Sum("monthly_amount"))
        return agg["s"] or 0

    @property
    def overhead_rate(self):
        """Ставка накладных: ₸ на единицу или ₸ на нормо-час."""
        total = self.monthly_fixed_total
        if self.method == self.Method.PER_UNIT:
            base = self.planned_monthly_units or 0
        else:
            base = self.planned_monthly_hours or 0
        return (total / base) if base else 0
