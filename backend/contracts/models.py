from django.db import models
from django.conf import settings


class Customer(models.Model):
    name = models.CharField(max_length=255)
    bin_iin = models.CharField("БИН/ИИН", max_length=12, blank=True)
    contact_person = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=32, blank=True)
    email = models.EmailField(blank=True)
    address = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

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

    number = models.CharField(max_length=50, unique=True)
    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name="contracts")
    title = models.CharField(max_length=255)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.NEW)
    amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    signed_date = models.DateField(null=True, blank=True)
    deadline = models.DateField(null=True, blank=True, help_text="Срок исполнения")
    specification = models.TextField(blank=True, help_text="Техническая спецификация")
    manager = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                on_delete=models.SET_NULL, related_name="managed_contracts")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"№{self.number} — {self.title}"

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
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    paid_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
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
