from rest_framework import serializers
from .models import UserAccess, User, AuditLog, Notification


class UserSerializer(serializers.ModelSerializer):
    role_display = serializers.CharField(source="get_role_display", read_only=True)
    perms = serializers.SerializerMethodField()
    # Пароль принимается и при изменении: человек забывает его, а другого
    # способа выдать новый в системе нет — своей страницы смены пароля
    # у сотрудника не предусмотрено.
    password = serializers.CharField(write_only=True, required=False, allow_blank=True,
                                     min_length=8,
                                     error_messages={"min_length": "Пароль короче 8 символов."})

    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name", "email", "phone",
                  "role", "role_display", "is_active", "perms", "password"]

    def update(self, instance, validated_data):
        pwd = validated_data.pop("password", None)
        user = super().update(instance, validated_data)
        if pwd:
            user.set_password(pwd)
            user.save(update_fields=["password"])
        return user

    def get_perms(self, obj):
        """Итоговые права — фронтенд прячет по ним меню, вкладки и кнопки.

        Отдаются и разделы целиком, и их части, поэтому интерфейс может
        закрыть отдельную вкладку, не закрывая весь раздел.
        """
        from .permissions import effective_perms
        return effective_perms(obj)


class UserCreateSerializer(UserSerializer):
    password = serializers.CharField(write_only=True, min_length=8,
                                     error_messages={"min_length": "Пароль короче 8 символов."})

    def create(self, validated_data):
        pwd = validated_data.pop("password")
        user = User(**validated_data)
        user.set_password(pwd)
        user.save()
        return user


class AuditLogSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.username", read_only=True, default=None)

    class Meta:
        model = AuditLog
        fields = "__all__"


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = "__all__"

class UserAccessSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", read_only=True)
    level_display = serializers.CharField(source="get_level_display", read_only=True)

    class Meta:
        model = UserAccess
        fields = ["id", "user", "username", "key", "level", "level_display", "note", "created_at"]

    def validate_key(self, value):
        from .permissions import ALL_KEYS
        if value not in ALL_KEYS:
            raise serializers.ValidationError(
                "Неизвестный ключ доступа. Допустимые перечислены в /api/access-keys/.")
        return value
