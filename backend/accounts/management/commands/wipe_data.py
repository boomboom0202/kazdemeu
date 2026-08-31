# -*- coding: utf-8 -*-
"""Полная очистка бизнес-данных перед вводом в эксплуатацию.

Удаляет всё, что накопилось за время демонстраций и проверок: договоры,
склад, производство, финансы, тендеры, уведомления и журнал действий.

НЕ удаляет: учётные записи (иначе в систему никто не войдёт), настройки
себестоимости (это конфигурация, а не данные) и точечные права.
Справочник этапов сбрасывается к пяти стандартным.

Запуск нарочно требует подтверждения:
    python manage.py wipe_data --yes-i-am-sure
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction


class Command(BaseCommand):
    help = "Удалить все бизнес-данные (договоры, склад, производство, финансы, тендеры)"

    def add_arguments(self, parser):
        parser.add_argument("--yes-i-am-sure", action="store_true",
                            help="Подтверждение: данные будут удалены безвозвратно")

    def handle(self, *args, **opts):
        if not opts["yes_i_am_sure"]:
            raise CommandError(
                "Операция необратима. Запустите с флагом --yes-i-am-sure, "
                "если действительно хотите стереть все бизнес-данные.")

        from accounts.models import Notification, AuditLog
        from contracts.models import (Comment, ContractFile, PaymentScheduleItem,
                                      Contract, Customer)
        from finance.models import CashEntry, FixedCost
        from tenders.models import Tender, Platform, OwnCompany
        from production.models import (ProductionStage, ProductionOrder, BOMItem,
                                       ProductRouteStage, PriceListItem, PriceList,
                                       Product, StageTemplate, ensure_default_stages)
        from warehouse.models import (FinishedGoodsMovement, MaterialBatch,
                                      StockMovement, Material, Supplier,
                                      PurchaseOrder)

        # Порядок важен: сначала зависимые записи, потом то, на что они ссылаются
        plan = [
            Notification, AuditLog,
            Comment, ContractFile, PaymentScheduleItem, CashEntry,
            Tender,
            ProductionStage, ProductionOrder,
            FinishedGoodsMovement, PurchaseOrder, MaterialBatch, StockMovement,
            BOMItem, ProductRouteStage, PriceListItem, PriceList,
            Product, Material, Supplier,
            Contract, Customer,
            Platform, OwnCompany,
            FixedCost, StageTemplate,
        ]

        with transaction.atomic():
            for model in plan:
                n, _ = model.objects.all().delete()
                self.stdout.write(f"  {model.__name__:24} удалено {n}")
            # чистый стандартный маршрут вместо накопившихся правок
            ensure_default_stages()

        self.stdout.write(self.style.SUCCESS(
            "Готово. Учётные записи и настройки себестоимости сохранены, "
            "справочник этапов сброшен к стандартным пяти."))
