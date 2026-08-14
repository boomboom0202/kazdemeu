from rest_framework import viewsets, mixins
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from django.db.models import Q
from .models import User, AuditLog, Notification
from .serializers import (UserSerializer, UserCreateSerializer,
                          AuditLogSerializer, NotificationSerializer)


class IsAdminRole(IsAuthenticated):
    def has_permission(self, request, view):
        return super().has_permission(request, view) and request.user.role == "admin"


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all().order_by("username")
    search_fields = ["username", "first_name", "last_name"]

    def get_serializer_class(self):
        return UserCreateSerializer if self.action == "create" else UserSerializer

    def get_permissions(self):
        # список нужен всем (назначение ответственных), изменение — только админ
        if self.action in ("list", "retrieve"):
            return [IsAuthenticated()]
        return [IsAdminRole()]

    def _guard(self, target, new_role=None, deleting=False):
        """Защита от потери доступа: нельзя разжаловать самого себя
        и нельзя убрать последнего администратора."""
        if target.pk == self.request.user.pk and (deleting or (new_role and new_role != "admin")):
            return ("Нельзя изменить роль или удалить собственную учётную запись — "
                    "вы потеряете доступ к системе. Попросите другого администратора.")
        if target.role == "admin" and (deleting or (new_role and new_role != "admin")):
            if User.objects.filter(role="admin", is_active=True).count() <= 1:
                return "Это последний администратор — система останется без управления."
        return None

    def perform_update(self, serializer):
        err = self._guard(serializer.instance, new_role=serializer.validated_data.get("role"))
        if err:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"detail": err})
        serializer.save()

    def destroy(self, request, *args, **kwargs):
        err = self._guard(self.get_object(), deleting=True)
        if err:
            return Response({"detail": err}, status=400)
        return super().destroy(request, *args, **kwargs)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    return Response(UserSerializer(request.user).data)


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AuditLog.objects.select_related("user")
    serializer_class = AuditLogSerializer
    filterset_fields = ["model_name", "action", "user"]
    search_fields = ["object_repr"]


class NotificationViewSet(mixins.ListModelMixin, mixins.UpdateModelMixin,
                          viewsets.GenericViewSet):
    serializer_class = NotificationSerializer

    def get_queryset(self):
        return Notification.objects.filter(Q(user=self.request.user) | Q(user__isnull=True))

    @action(detail=False, methods=["post"])
    def mark_all_read(self, request):
        self.get_queryset().update(is_read=True)
        return Response({"status": "ok"})

    @action(detail=False, methods=["post"])
    def refresh(self, request):
        """Сгенерировать уведомления: дедлайны договоров и просрочки платежей."""
        from django.utils import timezone
        from datetime import timedelta
        from contracts.models import Contract, PaymentScheduleItem
        today = timezone.localdate()
        soon = today + timedelta(days=7)
        for c in Contract.objects.filter(status="in_progress", deadline__isnull=False):
            if c.deadline < today:
                Notification.objects.get_or_create(
                    title=f"Срок истёк: договор №{c.number}",
                    defaults=dict(level="critical",
                                  message=f"Срок {c.deadline} прошёл.", link=f"/contracts/{c.id}"))
            elif c.deadline <= soon:
                Notification.objects.get_or_create(
                    title=f"Срок близко: договор №{c.number}",
                    defaults=dict(level="warning",
                                  message=f"Срок исполнения {c.deadline}.", link=f"/contracts/{c.id}"))
        for p in PaymentScheduleItem.objects.filter(due_date__lt=today).select_related("contract"):
            if not p.is_paid:
                Notification.objects.get_or_create(
                    title=f"Просрочен платёж по №{p.contract.number}",
                    defaults=dict(level="warning",
                                  message=f"Ожидалось {p.amount} до {p.due_date}, оплачено {p.paid_amount}.",
                                  link=f"/contracts/{p.contract_id}"))
        return Response({"status": "ok"})
