"""Договоры — реестр «Договора.xlsx», и деньги по каждому договору.

Раньше деньги жили отдельно: график платежей в договоре, касса в финансах,
расходы проектов в третьем месте. Теперь всё, что потрачено и получено
по договору, записано прямо в нём — как колонка в «Расходах.xlsx»:
строки расходов с комментарием и строки прихода от заказчика.
"""
from decimal import Decimal
from django.core.validators import MinValueValidator
from django.db import models
from django.conf import settings
from django.utils import timezone

POSITIVE_MONEY = [MinValueValidator(Decimal("0.01"))]
NON_NEGATIVE = [MinValueValidator(Decimal("0"))]
ZERO = Decimal("0")


class Source(models.TextChoices):
    """Откуда строка: внесена руками или загружена из таблицы. Повторная
    загрузка таблицы заменяет только загруженные строки — ручные остаются."""
    MANUAL = "manual", "Вручную"
    EXCEL = "excel", "Из Excel"


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
        Status.NEW: {Status.NEGOTIATION, Status.IN_PROGRESS, Status.CANCELLED},
        Status.NEGOTIATION: {Status.IN_PROGRESS, Status.CANCELLED},
        Status.IN_PROGRESS: {Status.CLOSED, Status.CANCELLED},
        Status.CLOSED: {Status.IN_PROGRESS},
        Status.CANCELLED: set(),
    }

    # Номер не уникален: в реестре у одной закупки бывает несколько позиций
    # (трусы, костюм, халат по 16561301-1).
    number = models.CharField("Номер", max_length=100)
    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name="contracts")
    title = models.CharField("Предмет закупки", max_length=255)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.NEW)
    amount = models.DecimalField("Сумма без НДС", max_digits=14, decimal_places=2, default=0,
                                 validators=NON_NEGATIVE)
    signed_date = models.DateField("Дата подписания", null=True, blank=True)
    deadline = models.DateField("Срок исполнения", null=True, blank=True)
    specification = models.TextField("Техническая спецификация", blank=True)
    manager = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                on_delete=models.SET_NULL, related_name="managed_contracts")

    # ── Колонки реестра «Договора.xlsx» ──
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

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"№{self.number} — {self.title}"

    def transition_error(self, new_status):
        """Причина, по которой переход запрещён, или None, если он допустим."""
        if new_status == self.status:
            return None
        labels = dict(self.Status.choices)
        allowed = self.TRANSITIONS.get(self.status, set())
        if new_status in allowed:
            return None
        can_go = ", ".join(f"«{labels.get(a, a)}»" for a in sorted(allowed)) or "никуда"
        return (f"Из статуса «{labels.get(self.status, self.status)}» нельзя перейти "
                f"в «{labels.get(new_status, new_status)}». Доступные переходы: {can_go}.")

    # Деньги считаются по заранее подтянутым строкам (prefetch payments, expenses):
    # в реестре десятки договоров, и запрос на каждый был бы слишком дорог.
    @property
    def paid_amount(self):
        return sum((p.amount for p in self.payments.all()), ZERO)

    @property
    def expenses_total(self):
        return sum((e.amount for e in self.expenses.all()), ZERO)

    @property
    def profit(self):
        """Что останется, когда заказчик заплатит всё: сумма договора − расходы."""
        return self.amount - self.expenses_total

    @property
    def balance(self):
        """Остаток, как внизу колонки в «Расходах»: пришло − потрачено."""
        return self.paid_amount - self.expenses_total

    @property
    def debt(self):
        return max(self.amount - self.paid_amount, ZERO)

    @property
    def is_overdue(self):
        return bool(self.deadline and self.status == self.Status.IN_PROGRESS
                    and self.deadline < timezone.localdate())


class ContractPayment(models.Model):
    """Оплата от заказчика — строка «приход» под колонкой договора."""
    contract = models.ForeignKey(Contract, on_delete=models.PROTECT, related_name="payments")
    date = models.DateField("Дата", null=True, blank=True, default=timezone.localdate)
    amount = models.DecimalField("Сумма", max_digits=14, decimal_places=2, validators=POSITIVE_MONEY)
    comment = models.CharField("Комментарий", max_length=255, blank=True)
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.MANUAL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = [models.F("date").desc(nulls_last=True), "-id"]

    def __str__(self):
        return f"{self.contract.number}: +{self.amount}"


class ContractExpense(models.Model):
    """Расход по договору — строка «сумма | комментарий», как в «Расходах.xlsx».
    Вид траты определяется по комментарию и правится руками."""
    contract = models.ForeignKey(Contract, on_delete=models.PROTECT, related_name="expenses")
    date = models.DateField("Дата", null=True, blank=True, default=timezone.localdate)
    amount = models.DecimalField("Сумма", max_digits=14, decimal_places=2, validators=POSITIVE_MONEY)
    comment = models.CharField("Комментарий", max_length=255, blank=True)
    kind = models.CharField("Вид", max_length=20, choices=ExpenseKind.choices,
                            default=ExpenseKind.OTHER)
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.MANUAL)
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "id"]

    def __str__(self):
        return f"{self.contract.number}: −{self.amount} {self.comment}"


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
