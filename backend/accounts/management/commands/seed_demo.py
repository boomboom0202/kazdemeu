"""Демо-данные: python manage.py seed_demo"""
from datetime import date, timedelta
from django.core.management.base import BaseCommand
from django.utils import timezone


class Command(BaseCommand):
    help = "Заполнить базу демонстрационными данными"

    def handle(self, *args, **kwargs):
        from accounts.models import User
        from contracts.models import Customer, Contract, PaymentScheduleItem, Comment
        from warehouse.models import Supplier, Material, MaterialBatch
        from production.models import (Product, BOMItem, ProductionOrder, PriceList,
                                       PriceListItem, ensure_default_stages)
        from finance.models import ExpenseCategory, CashEntry, FixedCost, CostSettings
        from tenders.models import Tender, Platform, OwnCompany

        admin, _ = User.objects.get_or_create(username="admin", defaults=dict(
            role="admin", is_staff=True, is_superuser=True, first_name="Админ"))
        admin.set_password("admin12345"); admin.save()
        manager, _ = User.objects.get_or_create(username="aigerim", defaults=dict(
            role="manager", first_name="Айгерим"))
        manager.set_password("demo12345"); manager.save()
        worker, _ = User.objects.get_or_create(username="bolat", defaults=dict(
            role="worker", first_name="Болат"))
        worker.set_password("demo12345"); worker.save()
        techno, _ = User.objects.get_or_create(username="saule", defaults=dict(
            role="technologist", first_name="Сауле"))
        techno.set_password("demo12345"); techno.save()
        buh, _ = User.objects.get_or_create(username="marat", defaults=dict(
            role="accountant", first_name="Марат"))
        buh.set_password("demo12345"); buh.save()

        ensure_default_stages()

        sup1, _ = Supplier.objects.get_or_create(name="ТОО Textile KZ", defaults=dict(phone="+7 701 111 22 33"))
        sup2, _ = Supplier.objects.get_or_create(name="ИП Фурнитура Юг")

        mats = {}
        for name, sku, unit, minst, sup in [
            ("Ткань бязь белая", "MAT-001", "м", 100, sup1),
            ("Ткань спецодежда саржа", "MAT-002", "м", 150, sup1),
            ("Нитки армированные", "MAT-003", "шт", 30, sup2),
            ("Пуговицы 18мм", "MAT-004", "шт", 500, sup2),
            ("Молния 60см", "MAT-005", "шт", 100, sup2),
        ]:
            m, _ = Material.objects.get_or_create(sku=sku, defaults=dict(
                name=name, unit=unit, min_stock=minst, default_supplier=sup))
            mats[sku] = m

        if not MaterialBatch.objects.exists():
            MaterialBatch.objects.create(material=mats["MAT-001"], supplier=sup1, batch_no="B-101",
                                         qty=800, unit_price=850, received_at=date.today() - timedelta(days=40))
            MaterialBatch.objects.create(material=mats["MAT-002"], supplier=sup1, batch_no="B-102",
                                         qty=800, unit_price=1400, received_at=date.today() - timedelta(days=35))
            MaterialBatch.objects.create(material=mats["MAT-003"], supplier=sup2, batch_no="B-103",
                                         qty=200, unit_price=300, received_at=date.today() - timedelta(days=30))
            MaterialBatch.objects.create(material=mats["MAT-004"], supplier=sup2, batch_no="B-104",
                                         qty=3000, unit_price=25, received_at=date.today() - timedelta(days=30))
            MaterialBatch.objects.create(material=mats["MAT-005"], supplier=sup2, batch_no="B-105",
                                         qty=600, unit_price=180, received_at=date.today() - timedelta(days=25))

        prods = {}
        for name, sku, price, labor, over, bom in [
            ("Халат медицинский", "PRD-001", 6500, 900, 400,
             [("MAT-001", 2.5), ("MAT-003", 0.2), ("MAT-004", 6)]),
            ("Костюм рабочий (куртка+брюки)", "PRD-002", 14500, 2200, 800,
             [("MAT-002", 3.8), ("MAT-003", 0.4), ("MAT-005", 1), ("MAT-004", 8)]),
            ("Фартук поварской", "PRD-003", 3200, 450, 200,
             [("MAT-001", 1.2), ("MAT-003", 0.1)]),
        ]:
            p, _ = Product.objects.get_or_create(sku=sku, defaults=dict(
                name=name, base_price=price, labor_cost=labor, overhead_cost=over))
            prods[sku] = p
            for msku, qty in bom:
                BOMItem.objects.get_or_create(product=p, material=mats[msku], defaults=dict(qty=qty))

        cust1, _ = Customer.objects.get_or_create(name="ГКП Городская больница №1",
                                                  defaults=dict(phone="+7 725 400 11 22"))
        cust2, _ = Customer.objects.get_or_create(name="ТОО СтройМонтаж")
        cust3, _ = Customer.objects.get_or_create(name="Сеть кафе Dastarkhan")

        pl, _ = PriceList.objects.get_or_create(name="Опт для больниц", customer=cust1)
        PriceListItem.objects.get_or_create(price_list=pl, product=prods["PRD-001"], defaults=dict(price=5900))

        today = timezone.localdate()
        c1, created = Contract.objects.get_or_create(number="Д-2026-014", defaults=dict(
            customer=cust1, title="Пошив 300 медицинских халатов", status="in_progress",
            amount=300 * 5900, signed_date=today - timedelta(days=50),
            deadline=today + timedelta(days=20), manager=manager,
            specification="Халат медицинский, бязь белая, ГОСТ. Размеры 44–56, логотип на кармане."))
        if created:
            PaymentScheduleItem.objects.create(contract=c1, due_date=today - timedelta(days=40),
                                               amount=885000, paid_amount=885000, paid_date=today - timedelta(days=38),
                                               note="Аванс 50%")
            PaymentScheduleItem.objects.create(contract=c1, due_date=today + timedelta(days=25), amount=885000,
                                               note="Окончательный расчёт")
            Comment.objects.create(contract=c1, author=manager, importance="important",
                                   text="Заказчик просит логотип по новому брендбуку — уточнить макет до кроя!")
            Comment.objects.create(contract=c1, author=admin, text="Ткань по партии B-101 зарезервирована.")

        c2, created = Contract.objects.get_or_create(number="Д-2026-018", defaults=dict(
            customer=cust2, title="Спецодежда: 120 рабочих костюмов", status="negotiation",
            amount=120 * 14500, deadline=today + timedelta(days=60), manager=manager,
            specification="Костюм рабочий саржа, СИЗ 2 класс, светоотражающие полосы."))

        c3, created = Contract.objects.get_or_create(number="Д-2025-097", defaults=dict(
            customer=cust3, title="Фартуки для персонала, 80 шт", status="closed",
            amount=80 * 3200, signed_date=today - timedelta(days=120),
            deadline=today - timedelta(days=60), manager=manager))

        po, created = ProductionOrder.objects.get_or_create(number="ПЗ-026", defaults=dict(
            contract=c1, product=prods["PRD-001"], qty=300, status="in_progress",
            materials_written_off=False))
        if created:
            po.create_stages()
            po.write_off_materials()
            stages = list(po.stages.all())
            for st, (norm, actual, status_) in zip(stages, [
                (24, 22, "done"), (120, 0, "in_progress"), (30, 0, "pending"),
                (16, 0, "pending"), (8, 0, "pending")]):
                st.norm_hours, st.actual_hours, st.status = norm, actual, status_
                st.assignee = worker
                st.save()

        cats = {}
        for name, kind in [("Материалы", "variable"), ("Зарплата", "variable"),
                           ("Аренда", "fixed"), ("Коммунальные", "fixed"), ("Прочее", "variable")]:
            cats[name], _ = ExpenseCategory.objects.get_or_create(name=name, defaults=dict(kind=kind))

        if not CashEntry.objects.exists():
            for months_ago, inc, mat, sal, rent in [
                (5, 1200000, 420000, 380000, 250000),
                (4, 1550000, 510000, 400000, 250000),
                (3, 980000, 300000, 380000, 250000),
                (2, 1730000, 560000, 420000, 250000),
                (1, 2100000, 640000, 450000, 250000),
                (0, 885000, 380000, 410000, 250000),
            ]:
                d = (today.replace(day=15) - timedelta(days=30 * months_ago))
                CashEntry.objects.create(direction="in", amount=inc, date=d,
                                         description="Поступления от заказчиков",
                                         contract=c1 if months_ago == 0 else None)
                CashEntry.objects.create(direction="out", amount=mat, date=d, category=cats["Материалы"],
                                         description="Закуп тканей и фурнитуры")
                CashEntry.objects.create(direction="out", amount=sal, date=d, category=cats["Зарплата"],
                                         description="ФОТ цеха")
                CashEntry.objects.create(direction="out", amount=rent, date=d, category=cats["Аренда"],
                                         description="Аренда цеха")

        # --- Постоянные расходы (вводятся один раз) + настройки себестоимости ---
        for name, amount, cat in [
            ("Аренда цеха", 250000, "Аренда"),
            ("Оклады АУП", 320000, "Зарплата"),
            ("Коммунальные услуги", 60000, "Коммунальные"),
            ("Интернет и связь", 15000, "Прочее"),
        ]:
            FixedCost.objects.get_or_create(name=name, defaults=dict(
                monthly_amount=amount, category=cats.get(cat)))
        s = CostSettings.get_solo()
        s.method = CostSettings.Method.PER_HOUR
        s.planned_monthly_hours = 1200
        s.planned_monthly_units = 800
        s.save()
        for p, hours in [("PRD-001", 0.8), ("PRD-002", 2.4), ("PRD-003", 0.4)]:
            Product.objects.filter(sku=p).update(norm_hours=hours)

        # --- Тендеры (план закупок) — по рабочим таблицам заказчика ---
        own, _ = OwnCompany.objects.get_or_create(name="Каз Демеу", defaults=dict(bin_iin=""))
        plats = {n: Platform.objects.get_or_create(name=n)[0]
                 for n in ["госзакуп", "Самрук-Казына", "Eurasiantech"]}
        if not Tender.objects.exists():
            for pl, pno, org, item, qty, price, plan, cost, dl, st, dec in [
                ("госзакуп", "17228455-1", "АО «Шығыс Жылу»", "Куртка для рабочих",
                 210, 17000, 16000, 11200, 10, "submitted", ""),
                ("Самрук-Казына", "1233176", "Теміржолсу-Маңғыстау", "Костюм рабочий",
                 90, 50488, 48000, 31500, 3, "planned", ""),
                ("госзакуп", "17292686-1", "АО «Аэропорт Шымкент»", "Костюм форменный (мужской)",
                 93, 50000, 46000, 30200, 21, "planned", ""),
                ("Eurasiantech", "№ 000061174", "ТОО Межрегионэнерготранзит",
                 "Костюм хлопчатобумажный", 80, 21206, 18000, 13400, -5, "won", "выиграли лот"),
                ("Самрук-Казына", "1233565", "АО «Алатау Жарық»", "Рукавицы",
                 2965, 1070, 0, 0, -12, "declined", "отбой — не наш профиль"),
            ]:
                Tender.objects.create(
                    platform=plats[pl], own_company=own, purchase_no=pno,
                    customer_name=org, item_name=item, qty=qty, price=price,
                    plan_price=plan, cost_per_unit=cost,
                    deadline=today + timedelta(days=dl), status=st, decision=dec,
                    manager=manager, delivery_days="60 дней")

        self.stdout.write(self.style.SUCCESS(
            "Демо-данные загружены. Логины: admin/admin12345, aigerim, saule (технолог), "
            "marat (бухгалтер), bolat — пароль demo12345"))
