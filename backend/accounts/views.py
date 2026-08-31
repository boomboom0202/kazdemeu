from rest_framework import viewsets, mixins
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from django.db.models import Q, F
from .models import User, AuditLog, Notification, UserAccess
from .serializers import (UserSerializer, UserCreateSerializer,
                          AuditLogSerializer, NotificationSerializer,
                          UserAccessSerializer)


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

    def _guard(self, target, new_role=None, deleting=False, deactivating=False):
        """Защита от потери доступа: нельзя разжаловать или отключить самого себя
        и нельзя убрать последнего администратора.

        Отключение приравнено к удалению: отключённый администратор в систему
        не войдёт, а значит последний из них так же оставит её без управления.
        """
        losing = deleting or deactivating or (new_role and new_role != "admin")
        if target.pk == self.request.user.pk and losing:
            return ("Нельзя изменить роль, отключить или удалить собственную учётную "
                    "запись — вы потеряете доступ к системе. Попросите другого "
                    "администратора.")
        if target.role == "admin" and losing:
            if User.objects.filter(role="admin", is_active=True).count() <= 1:
                return "Это последний администратор — система останется без управления."
        return None

    def perform_update(self, serializer):
        data = serializer.validated_data
        err = self._guard(serializer.instance, new_role=data.get("role"),
                          deactivating=(data.get("is_active") is False
                                        and serializer.instance.is_active))
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

        # Раньше здесь был get_or_create на каждый договор и платёж — то есть
        # запрос на строку, и всё это на каждой загрузке страницы. Теперь
        # собираем нужные уведомления в память, затем один SELECT уже
        # существующих и один bulk_create недостающих.
        wanted = []
        for c in Contract.objects.filter(status="in_progress", deadline__isnull=False):
            if c.deadline < today:
                wanted.append(Notification(
                    title=f"Срок истёк: договор №{c.number}", level="critical",
                    message=f"Срок {c.deadline} прошёл.", link=f"/contracts/{c.id}"))
            elif c.deadline <= soon:
                wanted.append(Notification(
                    title=f"Срок близко: договор №{c.number}", level="warning",
                    message=f"Срок исполнения {c.deadline}.", link=f"/contracts/{c.id}"))

        # is_paid — свойство модели, фильтровать по нему нельзя,
        # поэтому то же условие выражено через сравнение полей.
        overdue = (PaymentScheduleItem.objects
                   .filter(due_date__lt=today, paid_amount__lt=F("amount"))
                   .select_related("contract"))
        for p in overdue:
            wanted.append(Notification(
                title=f"Просрочен платёж по №{p.contract.number}", level="warning",
                message=f"Ожидалось {p.amount} до {p.due_date}, оплачено {p.paid_amount}.",
                link=f"/contracts/{p.contract_id}"))

        if wanted:
            titles = [n.title for n in wanted]
            existing = set(Notification.objects.filter(title__in=titles)
                           .values_list("title", flat=True))
            fresh, seen = [], set()
            for n in wanted:
                if n.title not in existing and n.title not in seen:
                    seen.add(n.title)
                    fresh.append(n)
            if fresh:
                Notification.objects.bulk_create(fresh)
        return Response({"status": "ok"})

class UserAccessViewSet(viewsets.ModelViewSet):
    """Точечные права. Раздаёт и отзывает только администратор."""
    queryset = UserAccess.objects.select_related("user")
    serializer_class = UserAccessSerializer
    permission_classes = [IsAdminRole]
    filterset_fields = ["user", "key", "level"]


@api_view(["GET"])
@permission_classes([IsAdminRole])
def access_keys(request):
    """Справочник ключей: разделы и их части, с человеческими названиями."""
    from .permissions import SECTIONS, AREAS
    titles = {"tenders": "Тендеры", "contracts": "Договоры", "catalog": "Изделия и каталог",
              "production": "Производство", "warehouse": "Склад", "finance": "Финансы",
              "analytics": "Аналитика"}
    return Response([
        {"section": s, "title": titles.get(s, s),
         "areas": [{"key": f"{s}.{a}", "title": t} for a, t in AREAS.get(s, {}).items()]}
        for s in SECTIONS
    ])
