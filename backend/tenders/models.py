"""Тендеры / план закупок — по рабочим таблицам заказчика.

Воронка: план → заявка подана → выиграли/проиграли/отбой.
Выигранный тендер превращается в договор одной кнопкой.
"""
from django.db import models
from django.conf import settings


class OwnCompany(models.Model):
    """Своё юрлицо, от которого подаётся заявка (в таблицах — «от какой фирмы подавались»)."""
    name = models.CharField("Название", max_length=150, unique=True)
    bin_iin = models.CharField("БИН", max_length=12, blank=True)
    note = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "Своё юрлицо"
        verbose_name_plural = "Свои юрлица"

    def __str__(self):
        return self.name


class Platform(models.Model):
    """Площадка закупок: госзакуп, Самрук-Казына, Eurasiantech и т.п."""
    name = models.CharField("Площадка", max_length=100, unique=True)
    url = models.URLField(blank=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "Площадка"
        verbose_name_plural = "Площадки закупок"

    def __str__(self):
        return self.name


class Tender(models.Model):
    """Закупка/лот из плана закупок."""

    class Status(models.TextChoices):
        PLANNED = "planned", "В плане (изучаем)"
        SUBMITTED = "submitted", "Заявка подана"
        REJECTED = "rejected", "Заявка отклонена"
        WON = "won", "Выиграли"
        LOST = "lost", "Проиграли"
        DECLINED = "declined", "Отбой (не участвуем)"

    # разрешённые переходы статусов
    TRANSITIONS = {
        Status.PLANNED: {Status.SUBMITTED, Status.DECLINED},
        Status.SUBMITTED: {Status.WON, Status.LOST, Status.REJECTED},
        Status.REJECTED: {Status.SUBMITTED, Status.DECLINED},
        Status.WON: set(),
        Status.LOST: set(),
        Status.DECLINED: {Status.PLANNED},
    }

    platform = models.ForeignKey(Platform, null=True, blank=True, on_delete=models.SET_NULL,
                                 related_name="tenders", verbose_name="Площадка")
    purchase_no = models.CharField("Номер закупки", max_length=100, blank=True)
    lot_no = models.CharField("Номер лота", max_length=100, blank=True)
    own_company = models.ForeignKey(OwnCompany, null=True, blank=True, on_delete=models.SET_NULL,
                                    verbose_name="От какой фирмы подаём")
    customer_name = models.CharField("Организация-заказчик", max_length=255)
    item_name = models.CharField("Наименование товара", max_length=255)
    product = models.ForeignKey("production.Product", null=True, blank=True, on_delete=models.SET_NULL,
                                verbose_name="Изделие из каталога",
                                help_text="Связь с каталогом — чтобы взять себестоимость по BOM")

    qty = models.PositiveIntegerField("Количество", default=0)
    price = models.DecimalField("Цена заказчика за ед., ₸", max_digits=14, decimal_places=2, default=0)
    plan_price = models.DecimalField("Наша плановая цена за ед., ₸", max_digits=14,
                                     decimal_places=2, default=0)
    cost_per_unit = models.DecimalField("Себестоимость за ед., ₸", max_digits=14,
                                        decimal_places=2, default=0,
                                        help_text="Можно подтянуть из каталога кнопкой")

    deadline = models.DateField("Дата окончания приёма заявок", null=True, blank=True)
    deadline_time = models.TimeField("Время окончания", null=True, blank=True)
    delivery_days = models.CharField("Срок поставки после договора", max_length=100, blank=True)
    samples_required = models.CharField("Предоставление образцов", max_length=255, blank=True)

    status = models.CharField("Статус", max_length=20, choices=Status.choices, default=Status.PLANNED)
    submitted_at = models.DateField("Заявка подана", null=True, blank=True)
    decision = models.CharField("Итоговое решение", max_length=255, blank=True)
    manager = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                on_delete=models.SET_NULL, related_name="tenders",
                                verbose_name="Ответственный")
    docs_url = models.URLField("Ссылка на документацию", blank=True)
    note = models.TextField("Комментарий", blank=True)

    contract = models.OneToOneField("contracts.Contract", null=True, blank=True,
                                    on_delete=models.SET_NULL, related_name="tender",
                                    verbose_name="Созданный договор")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Тендер / лот"
        verbose_name_plural = "Тендеры (план закупок)"

    def __str__(self):
        return f"{self.purchase_no or '—'} · {self.item_name}"

    # --- расчётные показатели (как в таблице заказчика) ---
    @property
    def customer_total(self):
        """Сумма по цене заказчика (без НДС) — ориентир бюджета лота."""
        return self.price * self.qty

    @property
    def plan_total(self):
        """Наша плановая выручка по лоту."""
        return self.plan_price * self.qty

    @property
    def cost_total(self):
        """Себестоимость всего объёма."""
        return self.cost_per_unit * self.qty

    @property
    def profit(self):
        """Плановая прибыль по лоту."""
        return self.plan_total - self.cost_total

    @property
    def margin_percent(self):
        t = self.plan_total
        return float(self.profit / t * 100) if t else 0

    @property
    def days_left(self):
        """Сколько дней до окончания приёма заявок (минус = просрочено)."""
        if not self.deadline:
            return None
        from django.utils import timezone
        return (self.deadline - timezone.localdate()).days

    @property
    def is_urgent(self):
        d = self.days_left
        return d is not None and 0 <= d <= 3 and self.status in (
            self.Status.PLANNED, self.Status.SUBMITTED)
