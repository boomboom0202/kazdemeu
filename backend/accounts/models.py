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
