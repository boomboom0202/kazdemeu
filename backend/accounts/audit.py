"""Автоматический аудит-лог через сигналы + middleware текущего пользователя."""
import threading
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver

_local = threading.local()


def set_current_user(user):
    _local.user = user


def get_current_user():
    return getattr(_local, "user", None)


AUDITED = set()  # заполняется в apps.ready()


def register(model):
    AUDITED.add(model)


@receiver(post_save)
def _log_save(sender, instance, created, **kwargs):
    if sender not in AUDITED:
        return
    from .models import AuditLog
    AuditLog.objects.create(
        user=get_current_user() if getattr(get_current_user(), "is_authenticated", False) else None,
        action="create" if created else "update",
        model_name=sender.__name__,
        object_id=str(instance.pk),
        object_repr=str(instance)[:255],
    )


@receiver(post_delete)
def _log_delete(sender, instance, **kwargs):
    if sender not in AUDITED:
        return
    from .models import AuditLog
    AuditLog.objects.create(
        user=get_current_user() if getattr(get_current_user(), "is_authenticated", False) else None,
        action="delete",
        model_name=sender.__name__,
        object_id=str(instance.pk),
        object_repr=str(instance)[:255],
    )
