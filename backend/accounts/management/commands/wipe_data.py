# -*- coding: utf-8 -*-
"""Полная очистка бизнес-данных.

Удаляет тендеры, договоры с оплатами и расходами, цех, склад, финансы,
уведомления и журнал действий. НЕ удаляет учётные записи — иначе в систему
никто не войдёт. Этапы цеха сбрасываются к стандартным.

С флагом --users заодно удаляются все сотрудники, кроме администраторов.

Запуск нарочно требует подтверждения:
    python manage.py wipe_data --yes-i-am-sure [--users]
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction


class Command(BaseCommand):
    help = "Удалить все бизнес-данные (тендеры, договоры, цех, склад, финансы)"

    def add_arguments(self, parser):
        parser.add_argument("--yes-i-am-sure", action="store_true",
                            help="Подтверждение: данные будут удалены безвозвратно")
        parser.add_argument("--users", action="store_true",
                            help="Заодно удалить всех сотрудников, кроме администраторов")

    def handle(self, *args, **opts):
        if not opts["yes_i_am_sure"]:
            raise CommandError(
                "Операция необратима. Запустите с флагом --yes-i-am-sure, "
                "если действительно хотите стереть все бизнес-данные.")

        from accounts.models import Notification, AuditLog, User
        from contracts.models import (Comment, ContractFile, ContractPayment, ContractExpense,
                                      Contract, Customer)
        from finance.models import AdminExpense, AdminCategory, OtherIncome
        from tenders.models import Tender, Platform, OwnCompany
        from warehouse.models import GoodsMovement, MaterialBatch, StockMovement, Material, Supplier
        from workshop.models import (SewingProgress, SewingJob, EntryMaterial, StageEntry,
                                     WorkOrderStage, WorkSize, WorkOrder, StageTemplate,
                                     ensure_default_stages)

        # Порядок важен: сначала зависимые записи, потом то, на что они ссылаются.
        # Журнал и уведомления идут последними: удаление само пишется в журнал.
        plan = [
            SewingProgress, SewingJob, EntryMaterial, StageEntry, WorkOrderStage, WorkSize,
            GoodsMovement, StockMovement, MaterialBatch,
            WorkOrder, StageTemplate,
            ContractPayment, ContractExpense, Comment, ContractFile, Tender,
            Contract, Customer, Platform, OwnCompany,
            Material, Supplier,
            AdminExpense, AdminCategory, OtherIncome,
        ]

        with transaction.atomic():
            for model in plan:
                n, _ = model.objects.all().delete()
                self.stdout.write(f"  {model.__name__:24} удалено {n}")

            if opts["users"]:
                doomed = User.objects.exclude(role="admin").exclude(is_superuser=True)
                names = list(doomed.values_list("username", flat=True))
                doomed.delete()
                self.stdout.write(f"  сотрудники               удалено {len(names)}"
                                  + (f" ({', '.join(names)})" if names else ""))

            if not User.objects.filter(role="admin", is_active=True).exists() \
                    and not User.objects.filter(is_superuser=True).exists():
                raise CommandError("Отменено: не осталось ни одного администратора.")

            ensure_default_stages()

            for model in (Notification, AuditLog):
                n, _ = model.objects.all().delete()
                self.stdout.write(f"  {model.__name__:24} удалено {n}")

        self.stdout.write(self.style.SUCCESS(
            "Готово. Учётные записи администраторов сохранены, этапы цеха сброшены к стандартным."))
