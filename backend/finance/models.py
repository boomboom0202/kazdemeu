"""Финансы — то, что не относится к одному договору.

Деньги договоров (оплаты заказчика и расходы) записаны в самих договорах.
Здесь — административные расходы, как в «Расход административные.xlsx»
(оклады, аренда, прочие траты цеха по месяцам), и прочие поступления,
не связанные с договором: заём, деньги инвестора.
Сводка по месяцам собирается из всех трёх источников.
"""
from decimal import Decimal
from django.core.validators import MinValueValidator
from django.db import models
from django.utils import timezone
from contracts.models import Source

POSITIVE_MONEY = [MinValueValidator(Decimal("0.01"))]
NON_NEGATIVE = [MinValueValidator(Decimal("0"))]


class AdminCategory(models.Model):
    """Статья административных расходов — колонка листа: «Оклад Алмата»."""
    name = models.CharField("Статья", max_length=150, unique=True)
    monthly_plan = models.DecimalField("План в месяц, ₸", max_digits=14, decimal_places=2,
                                       default=0, validators=NON_NEGATIVE,
                                       help_text="Сколько обычно уходит в месяц — для сверки с фактом")
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]

    def __str__(self):
        return self.name


class AdminExpense(models.Model):
    category = models.ForeignKey(AdminCategory, on_delete=models.PROTECT, related_name="expenses")
    amount = models.DecimalField("Сумма", max_digits=14, decimal_places=2, validators=POSITIVE_MONEY)
    comment = models.CharField("Комментарий", max_length=255, blank=True)
    month = models.DateField("Месяц", null=True, blank=True, help_text="Первое число месяца")
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.MANUAL)
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "id"]

    def __str__(self):
        return f"{self.category.name}: {self.amount}"


class OtherIncome(models.Model):
    """Поступление не от заказчика по договору: заём, вложение инвестора."""
    date = models.DateField("Дата", default=timezone.localdate)
    amount = models.DecimalField("Сумма", max_digits=14, decimal_places=2, validators=POSITIVE_MONEY)
    comment = models.CharField("Комментарий", max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-id"]

    def __str__(self):
        return f"+{self.amount} ({self.date})"
