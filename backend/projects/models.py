"""Деньги так, как их ведут в «Расходы.xlsx» и «Расход административные.xlsx».

Проект — колонка из «Расходов»: «Павлодар 741 шт ДИНА», «Бакад 2000шт».
Под ним построчно пишутся траты (сумма и короткий комментарий «дост»,
«ткань ашок») и приход. Остаток проекта = приход − расход, как внизу
колонки «Бакад». К проекту привязываются позиции реестра договоров.

Административные расходы — отдельный лист: статьи (оклады, аренда,
прочие траты цеха) и строки с суммой и комментарием. Месяц в таблице
нигде не записан отдельно — он спрятан в комментарии («хайр май окл»),
при загрузке система его оттуда достаёт.
"""
from decimal import Decimal
from django.core.validators import MinValueValidator
from django.db import models

POSITIVE_MONEY = [MinValueValidator(Decimal("0.01"))]


class Source(models.TextChoices):
    MANUAL = "manual", "Вручную"
    EXCEL = "excel", "Из Excel"


class Project(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "В работе"
        DONE = "done", "Завершён"

    name = models.CharField("Проект", max_length=200, unique=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    note = models.TextField("Примечание", blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["status", "name"]   # «active» по алфавиту раньше «done»

    def __str__(self):
        return self.name


class ExpenseKind(models.TextChoices):
    DELIVERY = "delivery", "Доставка"
    TRAVEL = "travel", "Командировки"
    SAMPLES = "samples", "Образцы и лекала"
    FABRIC = "fabric", "Ткань и материалы"
    ACCESSORIES = "accessories", "Фурнитура и шевроны"
    SEWING = "sewing", "Пошив, крой, вышивка"
    PACKAGING = "packaging", "Упаковка"
    PURCHASE = "purchase", "Закуп товара"
    PERCENT = "percent", "Проценты и сертификаты"
    LEGAL = "legal", "Пени, суды, документы"
    OTHER = "other", "Прочее"


class ProjectExpense(models.Model):
    """Строка траты под проектом. Проект с тратами не удаляется (PROTECT)."""
    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="expenses")
    amount = models.DecimalField("Сумма", max_digits=14, decimal_places=2, validators=POSITIVE_MONEY)
    comment = models.CharField("Комментарий", max_length=255, blank=True)
    kind = models.CharField("Вид", max_length=20, choices=ExpenseKind.choices, default=ExpenseKind.OTHER)
    date = models.DateField("Дата", null=True, blank=True)
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.MANUAL)
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "id"]


class ProjectIncome(models.Model):
    """Приход по проекту — деньги, которые пришли от заказчика."""
    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name="incomes")
    amount = models.DecimalField("Сумма", max_digits=14, decimal_places=2, validators=POSITIVE_MONEY)
    comment = models.CharField("Комментарий", max_length=255, blank=True)
    date = models.DateField("Дата", null=True, blank=True)
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.MANUAL)
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "id"]


class AdminCategory(models.Model):
    """Статья административных расходов: «Оклад Алмата», «Аренда Алмата цех»…"""
    name = models.CharField("Статья", max_length=150, unique=True)
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["position", "name"]

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
