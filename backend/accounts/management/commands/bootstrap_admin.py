# -*- coding: utf-8 -*-
"""Гарантирует, что в системе есть хотя бы один администратор.

Вызывается при каждом старте контейнера. Если администратор уже есть,
команда молчит и ничего не трогает — пароль существующего не меняется.
Если администраторов не осталось (стёрли базу, ошиблись при чистке),
создаётся учётная запись из ADMIN_LOGIN / ADMIN_PASSWORD, иначе
admin / admin12345 с требованием сразу сменить пароль.
"""
import os
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Создать администратора, если в системе не осталось ни одного"

    def handle(self, *args, **kwargs):
        from accounts.models import User

        if User.objects.filter(is_superuser=True).exists():
            return

        login = os.environ.get("ADMIN_LOGIN", "admin")
        password = os.environ.get("ADMIN_PASSWORD", "admin12345")

        user, _ = User.objects.get_or_create(
            username=login,
            defaults=dict(role="admin", first_name="Администратор"),
        )
        user.role = "admin"
        user.is_staff = True
        user.is_superuser = True
        user.set_password(password)
        user.save()

        self.stdout.write(self.style.WARNING(
            f">> Администраторов не было — создан «{login}». "
            "Смените пароль сразу после входа."))
