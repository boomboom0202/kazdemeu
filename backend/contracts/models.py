from decimal import Decimal
from django.core.validators import MinValueValidator
from django.db import models
from django.conf import settings

POSITIVE_MONEY = [MinValueValidator(Decimal("0.01"))]
NON_NEGATIVE = [MinValueValidator(Decimal("0"))]


class Customer(models.Model):
    name = models.CharField(max_length=255)
    bin_iin = models.CharField("БИН/ИИН", max_length=12, blank=True)
    contact_person = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=32, blank=True)
    email = models.EmailField(blank=True)
    address = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Contract(models.Model):
    class Status(models.TextChoices):
        NEW = "new", "Новый"
        NEGOTIATION = "negotiation", "Согласование"
        IN_PROGRESS = "in_progress", "В работе"
        CLOSED = "closed", "Закрыт"
        CANCELLED = "cancelled", "Отменён"

    TRANSITIONS = {
        Status.NEW: {Status.NEGOTIATION, Status.CANCELLED},
        Status.NEGOTIATION: {Status.IN_PROGRESS, Status.CANCELLED},
        Status.IN_PROGRESS: {Status.CLOSED, Status.CANCELLED},
        Status.CLOSED: set(),
        Status.CANCELLED: set(),
    }

    # Номер не уникален: в реестре у одной закупки бывает несколько позиций
    # (трусы, костюм, халат по 16561301-1), а раньше уникальность склеивала
    # их при загрузке в одну строку и молча теряла остальные.
    number = models.CharField("Номер", max_length=100)
    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name="contracts")
    title = models.CharField(max_length=255)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.NEW)
    amount = models.DecimalField(max_digits=14, decimal_places=2, default=0,
                                 validators=NON_NEGATIVE)
    signed_date = models.DateField(null=True, blank=True)
    deadline = models.DateField(null=True, blank=True, help_text="Срок исполнения")
    specification = models.TextField(blank=True, help_text="Техническая спецификация")
    manager = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                on_delete=models.SET_NULL, related_name="managed_contracts")

    # ── Колонки реестра «Договора.xlsx»: одна строка — одна позиция закупки ──
    purchase_no = models.CharField("Номер закупки", max_length=100, blank=True, db_index=True)
    own_company = models.ForeignKey("tenders.OwnCompany", null=True, blank=True,
                                    on_delete=models.SET_NULL, related_name="contracts",
                                    verbose_name="С какой фирмы")
    platform = models.CharField("Площадка", max_length=100, blank=True)
    qty = models.DecimalField("Кол-во", max_digits=14, decimal_places=3, null=True, blank=True,
                              validators=NON_NEGATIVE)
    price = models.DecimalField("Цена", max_digits=14, decimal_places=2, null=True, blank=True,
                                validators=NON_NEGATIVE)
    contract_no = models.CharField("Номер договора", max_length=100, blank=True)
    costs_note = models.CharField("Затраты", max_length=100, blank=True)
    comment = models.TextField("Комментарии", blank=True)
    investor = models.CharField("Инвестор", max_length=150, blank=True)
    payment_note = models.CharField("Оплата", max_length=100, blank=True)
    delivery_place = models.CharField("Место поставки", max_length=255, blank=True)
    delivery_terms = models.TextField("Срок поставки", blank=True)
    planned_execution = models.CharField("Планируемый срок исполнения", max_length=100, blank=True)
    phone = models.CharField("Телефон", max_length=255, blank=True)
    note = models.TextField("Коментарий", blank=True)
    project = models.ForeignKey("projects.Project", null=True, blank=True,
                                on_delete=models.SET_NULL, related_name="contracts",
                                verbose_name="Проект")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"№{self.number} — {self.title}"

    def transition_error(self, new_status):
        """Причина, по которой переход запрещён, или None, если он допустим.

        Правило одно на всю систему: и для кнопок статуса, и для обычного
        сохранения договора. Раньше цепочка проверялась только в set_status,
        а PATCH договора менял статус куда угодно — договор можно было
        закрыть, минуя согласование и работу.
        """
        if new_status == self.status:
            return None
        labels = dict(self.Status.choices)
        allowed = self.TRANSITIONS.get(self.status, set())
        if new_status in allowed:
            return None
        can_go = ", ".join(f"«{labels.get(a, a)}»" for a in sorted(allowed)) or "никуда"
        return (f"Из статуса «{labels.get(self.status, self.status)}» нельзя перейти "
                f"в «{labels.get(new_status, new_status)}». Доступные переходы: {can_go}.")

    @property
    def paid_amount(self):
        return sum(p.paid_amount for p in self.payment_schedule.all())

    @property
    def is_overdue(self):
        from django.utils import timezone
        return bool(self.deadline and self.status == self.Status.IN_PROGRESS
                    and self.deadline < timezone.localdate())


class PaymentScheduleItem(models.Model):
    """График платежей: когда и сколько должно поступить, и сколько поступило."""
    contract = models.ForeignKey(Contract, on_delete=models.CASCADE, related_name="payment_schedule")
    due_date = models.DateField()
    amount = models.DecimalField(max_digits=14, decimal_places=2, validators=POSITIVE_MONEY)
    paid_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0,
                                      validators=NON_NEGATIVE)
    paid_date = models.DateField(null=True, blank=True)
    note = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["due_date"]

    @property
    def is_paid(self):
        return self.paid_amount >= self.amount

    def __str__(self):
        return f"{self.contract.number}: {self.amount} до {self.due_date}"


class ContractFile(models.Model):
    """Эскиз, макет, техкарта — файл или внешняя ссылка."""
    class Kind(models.TextChoices):
        SKETCH = "sketch", "Эскиз"
        LAYOUT = "layout", "Макет"
        TECHCARD = "techcard", "Техкарта"
        PHOTO = "photo", "Фото"
        OTHER = "other", "Другое"

    contract = models.ForeignKey(Contract, on_delete=models.CASCADE, related_name="files")
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.OTHER)
    file = models.FileField(upload_to="contracts/%Y/%m/", blank=True, null=True)
    url = models.URLField(blank=True, help_text="Внешняя ссылка (если файл не загружен)")
    title = models.CharField(max_length=255, blank=True)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.title or (self.file.name if self.file else self.url)


class Comment(models.Model):
    """История комментариев: кто, когда; важные идут в уведомления."""
    class Importance(models.TextChoices):
        NORMAL = "normal", "Обычный"
        IMPORTANT = "important", "Важный"

    contract = models.ForeignKey(Contract, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    text = models.TextField()
    importance = models.CharField(max_length=10, choices=Importance.choices, default=Importance.NORMAL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        created = self.pk is None
        super().save(*args, **kwargs)
        if created and self.importance == self.Importance.IMPORTANT:
            from accounts.models import Notification
            Notification.objects.create(
                level=Notification.Level.CRITICAL,
                title=f"Важный комментарий: договор №{self.contract.number}",
                message=self.text[:500],
                link=f"/contracts/{self.contract_id}",
            )
