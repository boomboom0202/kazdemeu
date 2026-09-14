"""Цех так, как его ведут в «цех отчёт.xlsx».

Заказ цеха — это изделие и сетка размеров с планом. По каждому размеру
отдельно копятся факты: сколько скроили (и сколько ушло ткани), сколько
вышили, сколько выдали бригадам на пошив и насколько они готовы по дням,
сколько упаковали. Из этих фактов и складывается картина «сколько сшито
по размерам», в которую можно провалиться с уровня заказа.
"""
from decimal import Decimal
from django.core.validators import MinValueValidator, MaxValueValidator
from django.db import models
from django.utils import timezone

NON_NEGATIVE = [MinValueValidator(Decimal("0"))]
AT_LEAST_ONE = [MinValueValidator(1)]


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
    """Заказ цеха: какое изделие шьём и в каких размерах."""
    class Status(models.TextChoices):
        IN_WORK = "in_work", "В работе"
        DONE = "done", "Сдан"

    product = models.CharField("Изделие", max_length=150)
    contract = models.ForeignKey("contracts.Contract", null=True, blank=True,
                                 on_delete=models.SET_NULL, related_name="work_orders")
    project = models.ForeignKey("projects.Project", null=True, blank=True,
                                on_delete=models.SET_NULL, related_name="work_orders")
    client = models.CharField("Для кого", max_length=200, blank=True,
                              help_text="Если договора нет: «Павлодар», «частный заказ»")
    deadline = models.DateField("Срок", null=True, blank=True)
    sewing_rate = models.DecimalField("Расценка пошива, ₸/шт", max_digits=10, decimal_places=2,
                                      default=0, validators=NON_NEGATIVE)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.IN_WORK)
    note = models.TextField("Примечание", blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # «in_work» по алфавиту дальше «done» — обратный порядок ставит рабочие сверху
        ordering = ["-status", "-created_at"]

    def __str__(self):
        return self.product


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


# Записи цеха ссылаются на размер с PROTECT: это факты. Размер, по которому
# уже кроили или шили, нельзя удалить вместе с историей — только исправить
# записи. По той же причине не удалится заказ, в котором есть записи.

class CutEntry(models.Model):
    """Крой за день. На одну кройку уходит и основа, и подклад, и флис,
    поэтому расход ткани лежит отдельными строками по материалам."""
    size = models.ForeignKey(WorkSize, on_delete=models.PROTECT, related_name="cuts")
    date = models.DateField("Дата", default=timezone.localdate)
    qty = models.PositiveIntegerField("Скроено, шт", validators=AT_LEAST_ONE)
    note = models.CharField("Примечание", max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-id"]


class CutMaterial(models.Model):
    cut = models.ForeignKey(CutEntry, on_delete=models.CASCADE, related_name="materials")
    material = models.CharField("Материал", max_length=60)
    meters = models.DecimalField("Расход, м", max_digits=10, decimal_places=2,
                                 validators=NON_NEGATIVE)

    class Meta:
        ordering = ["id"]
        unique_together = ("cut", "material")

    @property
    def per_unit(self):
        """Метров на штуку — в отчёте его считают на полях руками (2,44 м)."""
        return self.meters / self.cut.qty if self.cut.qty else Decimal("0")


class EmbroideryEntry(models.Model):
    size = models.ForeignKey(WorkSize, on_delete=models.PROTECT, related_name="embroidery")
    date = models.DateField("Дата", default=timezone.localdate)
    qty = models.PositiveIntegerField("Вышито, шт", validators=AT_LEAST_ONE)
    kind = models.CharField("Вид", max_length=60, blank=True, help_text="полный, карман…")
    note = models.CharField("Примечание", max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-id"]


class SewingJob(models.Model):
    """Партия размера, выданная бригаде на пошив."""
    size = models.ForeignKey(WorkSize, on_delete=models.PROTECT, related_name="sewing")
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


class PackEntry(models.Model):
    """Упаковка: готовые изделия ушли со стола цеха."""
    size = models.ForeignKey(WorkSize, on_delete=models.PROTECT, related_name="packs")
    date = models.DateField("Дата", default=timezone.localdate)
    qty = models.PositiveIntegerField("Упаковано, шт", validators=AT_LEAST_ONE)
    note = models.CharField("Примечание", max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-id"]
