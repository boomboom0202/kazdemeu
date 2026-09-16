"""Цех так, как его ведут в «цех отчёт.xlsx».

Заказ цеха запускается из договора: изделие и сетка размеров с планом.
Заказ проходит этапы — их набор и порядок задаются в настройках цеха
(Крой, Вышивка, Тигин, Чистка, Упаковка…). Каждый этап — это лист
отчёта цеха: у кроя записи с расходом ткани, у пошива партии бригад
с готовностью по дням, у остальных — штуки по размерам.

Записи ссылаются на этап заказа и размер с PROTECT: это факты. Этап или
размер, по которому уже работали, нельзя удалить вместе с историей.
"""
from decimal import Decimal
from django.core.validators import MinValueValidator, MaxValueValidator
from django.db import models
from django.utils import timezone

NON_NEGATIVE = [MinValueValidator(Decimal("0"))]
AT_LEAST_ONE = [MinValueValidator(1)]


class StageTemplate(models.Model):
    """Этап цеха из настроек. Вид этапа определяет, как выглядит его лист."""
    class Kind(models.TextChoices):
        CUT = "cut", "Крой — штуки и расход ткани"
        COUNT = "count", "Штуки по размерам"
        SEWING = "sewing", "Пошив — партии бригад, готовность по дням"

    name = models.CharField("Этап", max_length=60, unique=True)
    kind = models.CharField("Вид листа", max_length=10, choices=Kind.choices, default=Kind.COUNT)
    extra_label = models.CharField(
        "Дополнительная колонка", max_length=40, blank=True,
        help_text="Например «Вид» у вышивки: полный, карман. Пусто — колонки нет")
    position = models.PositiveSmallIntegerField("Порядок", default=0)
    is_active = models.BooleanField("Включать в новые заказы", default=True)

    class Meta:
        ordering = ["position", "id"]

    def __str__(self):
        return self.name


DEFAULT_STAGES = [
    # название, вид, доп. колонка, в новых заказах
    ("Крой", StageTemplate.Kind.CUT, "", True),
    ("Вышивка", StageTemplate.Kind.COUNT, "Вид", True),
    ("Тигин", StageTemplate.Kind.SEWING, "", True),
    ("Чистка", StageTemplate.Kind.COUNT, "", True),
    ("Упаковка", StageTemplate.Kind.COUNT, "", True),
]


def ensure_default_stages():
    """Стандартные этапы, если настройки цеха пусты."""
    if StageTemplate.objects.exists():
        return
    for pos, (name, kind, extra, active) in enumerate(DEFAULT_STAGES):
        StageTemplate.objects.create(name=name, kind=kind, extra_label=extra,
                                     position=pos, is_active=active)


class Brigade(models.Model):
    """Бригада пошива. В отчёте цеха пишут «Наср + 9 бала» — бригадир
    и сколько людей с ним; так и храним."""
    leader = models.CharField("Бригадир", max_length=100)
    people = models.PositiveSmallIntegerField("Людей с бригадиром", default=0)
    note = models.CharField("Примечание", max_length=255, blank=True)
    is_active = models.BooleanField("Работает", default=True)

    class Meta:
        ordering = ["-is_active", "leader"]

    def __str__(self):
        return f"{self.leader} + {self.people}" if self.people else self.leader


class WorkOrder(models.Model):
    """Заказ цеха: какое изделие шьём по договору и в каких размерах."""
    class Status(models.TextChoices):
        IN_WORK = "in_work", "В работе"
        DONE = "done", "Сдан"

    product = models.CharField("Изделие", max_length=150)
    contract = models.ForeignKey("contracts.Contract", null=True, blank=True,
                                 on_delete=models.SET_NULL, related_name="work_orders")
    client = models.CharField("Для кого", max_length=200, blank=True,
                              help_text="Если договора нет: «частный заказ»")
    deadline = models.DateField("Срок", null=True, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.IN_WORK)
    note = models.TextField("Примечание", blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # «in_work» по алфавиту дальше «done» — обратный порядок ставит рабочие сверху
        ordering = ["-status", "-created_at"]

    def __str__(self):
        return self.product


class WorkOrderStage(models.Model):
    """Этап, который проходит этот заказ. Порядок этапов общий для всех
    заказов — из настроек цеха: переставили этап там, и он переставился везде."""
    order = models.ForeignKey(WorkOrder, on_delete=models.CASCADE, related_name="stages")
    template = models.ForeignKey(StageTemplate, on_delete=models.PROTECT, related_name="order_stages")

    class Meta:
        ordering = ["template__position", "template_id"]
        unique_together = ("order", "template")

    def __str__(self):
        return f"{self.order.product}: {self.template.name}"


class WorkSize(models.Model):
    """Строка сетки: размер и сколько штук его нужно."""
    order = models.ForeignKey(WorkOrder, on_delete=models.CASCADE, related_name="sizes")
    size = models.CharField("Размер", max_length=40)
    planned = models.PositiveIntegerField("План, шт", validators=AT_LEAST_ONE)
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]
        unique_together = ("order", "size")

    def __str__(self):
        return f"{self.order.product} {self.size}"


class StageEntry(models.Model):
    """Запись этапа за день: сколько штук размера прошло этап."""
    stage = models.ForeignKey(WorkOrderStage, on_delete=models.PROTECT, related_name="entries")
    size = models.ForeignKey(WorkSize, on_delete=models.PROTECT, related_name="entries")
    date = models.DateField("Дата", default=timezone.localdate)
    qty = models.PositiveIntegerField("Штук", validators=AT_LEAST_ONE)
    extra = models.CharField("Доп. колонка", max_length=60, blank=True)
    note = models.CharField("Примечание", max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-id"]


class EntryMaterial(models.Model):
    """Расход ткани в записи кроя: на одну кройку уходит и основа, и подклад."""
    entry = models.ForeignKey(StageEntry, on_delete=models.CASCADE, related_name="materials")
    material = models.CharField("Материал", max_length=60)
    meters = models.DecimalField("Расход, м", max_digits=10, decimal_places=2,
                                 validators=NON_NEGATIVE)

    class Meta:
        ordering = ["id"]
        unique_together = ("entry", "material")

    @property
    def per_unit(self):
        """Метров на штуку — в отчёте его считают на полях руками (2,44 м)."""
        return self.meters / self.entry.qty if self.entry.qty else Decimal("0")


class SewingJob(models.Model):
    """Партия размера, выданная бригаде на этапе пошива."""
    stage = models.ForeignKey(WorkOrderStage, on_delete=models.PROTECT, related_name="jobs")
    size = models.ForeignKey(WorkSize, on_delete=models.PROTECT, related_name="jobs")
    brigade = models.ForeignKey(Brigade, on_delete=models.PROTECT, related_name="jobs")
    qty = models.PositiveIntegerField("Выдано, шт", validators=AT_LEAST_ONE)
    started = models.DateField("Выдано", default=timezone.localdate)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-started", "-id"]


class SewingProgress(models.Model):
    """Готовность партии на дату — как в отчёте: 0,3 → 0,6 → «на упаковке».
    Может и уменьшиться: при пересмотре цех ставит меньше, и это нормально."""
    job = models.ForeignKey(SewingJob, on_delete=models.CASCADE, related_name="progress")
    date = models.DateField("Дата", default=timezone.localdate)
    ready = models.DecimalField("Готовность", max_digits=4, decimal_places=3,
                                validators=[MinValueValidator(Decimal("0")),
                                            MaxValueValidator(Decimal("1"))])

    class Meta:
        ordering = ["date", "id"]
