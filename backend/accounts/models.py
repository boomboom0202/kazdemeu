from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Role(models.TextChoices):
        ADMIN = "admin", "Администратор"
        DIRECTOR = "director", "Директор (обзор и решения по тендерам)"
        MANAGER = "manager", "Менеджер (тендеры/договоры)"
        TECHNOLOGIST = "technologist", "Технолог (изделия, BOM, техкарты, нормы)"
        ACCOUNTANT = "accountant", "Бухгалтер (финансы)"
        WAREHOUSE = "warehouse", "Кладовщик"
        WORKER = "worker", "Сотрудник цеха"
        VIEWER = "viewer", "Только просмотр"

    role = models.CharField(max_length=20, choices=Role.choices, default=Role.VIEWER)
    phone = models.CharField(max_length=32, blank=True)

    def __str__(self):
        return f"{self.get_full_name() or self.username} ({self.get_role_display()})"


class AuditLog(models.Model):
    """Журнал действий: кто, что и когда изменил."""
    user = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name="audit_logs")
    action = models.CharField(max_length=10)  # create / update / delete
    model_name = models.CharField(max_length=100)
    object_id = models.CharField(max_length=64)
    object_repr = models.CharField(max_length=255, blank=True)
    changes = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class Notification(models.Model):
    """Уведомления: срок близко, остаток низкий, важный комментарий и т.п."""
    class Level(models.TextChoices):
        INFO = "info", "Инфо"
        WARNING = "warning", "Предупреждение"
        CRITICAL = "critical", "Важно"

    user = models.ForeignKey(User, null=True, blank=True, on_delete=models.CASCADE,
                             related_name="notifications", help_text="Пусто = всем")
    level = models.CharField(max_length=10, choices=Level.choices, default=Level.INFO)
    title = models.CharField(max_length=200)
    message = models.TextField(blank=True)
    link = models.CharField(max_length=255, blank=True)  # маршрут во фронтенде
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

class UserAccess(models.Model):
    """Точечное право конкретного пользователя на раздел или его часть.

    Роль задаёт доступ по умолчанию, а эти правила его уточняют — можно
    открыть кладовщику финансы целиком, а можно выдать бухгалтеру одну
    вкладку склада, не меняя роль и не трогая остальных с той же ролью.

    Ключ — либо раздел («warehouse»), либо его часть («warehouse.batches»).
    Правило на часть важнее правила на раздел, а любое правило важнее роли.
    """
    class Level(models.TextChoices):
        NONE = "none", "Нет доступа"
        READ = "read", "Только просмотр"
        WRITE = "write", "Просмотр и изменение"

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="access_rules")
    key = models.CharField("Ключ доступа", max_length=64)
    level = models.CharField("Уровень", max_length=10, choices=Level.choices)
    note = models.CharField("Основание", max_length=255, blank=True,
                            help_text="Зачем выдано — чтобы через полгода было понятно")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "key")
        ordering = ["user", "key"]
        verbose_name = "Точечное право"
        verbose_name_plural = "Точечные права"

    def __str__(self):
        return f"{self.user.username}: {self.key} = {self.level}"

