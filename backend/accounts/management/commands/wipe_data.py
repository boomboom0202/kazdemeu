# -*- coding: utf-8 -*-
"""Полная очистка бизнес-данных перед вводом в эксплуатацию.

Удаляет всё, что накопилось за время демонстраций и проверок: договоры,
склад, производство, финансы, тендеры, уведомления и журнал действий.

НЕ удаляет: учётные записи (иначе в систему никто не войдёт) и настройки
себестоимости — это конфигурация, а не данные.
Справочник этапов сбрасывается к пяти стандартным.

С флагом --users заодно удаляются все сотрудники, кроме администраторов:
при вводе в эксплуатацию учётные записи заводятся заново, под настоящих
людей. Администратор остаётся всегда — без него в систему не войти.

Запуск нарочно требует подтверждения:
    python manage.py wipe_data --yes-i-am-sure [--users]
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction


class Command(BaseCommand):
    help = "Удалить все бизнес-данные (договоры, склад, производство, финансы, тендеры)"

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
        from contracts.models import (Comment, ContractFile, PaymentScheduleItem,
                                      Contract, Customer)
        from finance.models import CashEntry, FixedCost, ExpenseCategory
        from tenders.models import Tender, Platform, OwnCompany
        from production.models import (ProductionStage, ProductionOrder, BOMItem,
                                       ProductRouteStage, PriceListItem, PriceList,
                                       Product, StageTemplate, ensure_default_stages)
        from warehouse.models import (FinishedGoodsMovement, MaterialBatch,
                                      StockMovement, Material, Supplier,
                                      PurchaseOrder)

        # Порядок важен: сначала зависимые записи, потом то, на что они ссылаются.
        # Журнал и уведомления идут последними: удаление записей само пишется
        # в журнал, и вычищенный первым он снова оказался бы полным.
        plan = [
            Comment, ContractFile, PaymentScheduleItem, CashEntry,
            Tender,
            ProductionStage, ProductionOrder,
            FinishedGoodsMovement, PurchaseOrder, MaterialBatch, StockMovement,
            BOMItem, ProductRouteStage, PriceListItem, PriceList,
            Product, Material, Supplier,
            Contract, Customer,
            Platform, OwnCompany,
            FixedCost, ExpenseCategory, StageTemplate,
        ]

        with transaction.atomic():
            for model in plan:
                n, _ = model.objects.all().delete()
                self.stdout.write(f"  {model.__name__:24} удалено {n}")

            if opts["users"]:
                # Администраторы неприкосновенны в любом случае: удалить
                # последнего значит запереть систему снаружи.
                doomed = User.objects.exclude(role="admin").exclude(is_superuser=True)
                names = list(doomed.values_list("username", flat=True))
                doomed.delete()
                self.stdout.write(f"  сотрудники               удалено {len(names)}"
                                  + (f" ({', '.join(names)})" if names else ""))

            if not User.objects.filter(is_superuser=True).exists():
                raise CommandError("Отменено: не осталось ни одного администратора.")

            # чистый стандартный маршрут вместо накопившихся правок
            ensure_default_stages()

            # и в самом конце — журнал, куда всё вышеперечисленное только что записалось
            for model in (Notification, AuditLog):
                n, _ = model.objects.all().delete()
                self.stdout.write(f"  {model.__name__:24} удалено {n}")

        self.stdout.write(self.style.SUCCESS(
            "Готово. Настройки себестоимости и учётная запись администратора "
            "сохранены, справочник этапов сброшен к стандартным пяти."))
