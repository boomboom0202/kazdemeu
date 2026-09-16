"""Демо-данные: python manage.py seed_demo

Вся цепочка на примерах: тендер → договор с расходами и оплатами → заказ
цеха по этапам → склад и финансы. Данные создаются только в пустой базе
(если договоров нет) — введённое руками не затирается.
"""
from datetime import timedelta
from decimal import Decimal
from django.core.management.base import BaseCommand
from django.utils import timezone


class Command(BaseCommand):
    help = "Заполнить базу демонстрационными данными"

    def handle(self, *args, **kwargs):
        from accounts.models import User
        from contracts.models import Customer, Contract, ContractPayment, ContractExpense, Comment
        from contracts.excel import classify
        from finance.models import AdminCategory, AdminExpense, OtherIncome
        from tenders.models import Tender, Platform, OwnCompany
        from warehouse.models import Supplier, Material, MaterialBatch, StockMovement
        from workshop.models import (Brigade, WorkOrder, StageTemplate, StageEntry, EntryMaterial,
                                     SewingJob, SewingProgress, ensure_default_stages)
        from workshop.calc import apply_sizes, parse_sizes, set_route

        def demo_user(username, password, **fields):
            """Пароль ставится только при создании: seed_demo выполняется при каждом
            старте контейнера, и сменённый пароль не должен откатываться."""
            user, created = User.objects.get_or_create(username=username, defaults=fields)
            if created:
                user.set_password(password)
                user.save()
            return user

        demo_user("admin", "admin12345", role="admin", is_staff=True, is_superuser=True, first_name="Админ")
        manager = demo_user("aigerim", "demo12345", role="manager", first_name="Айгерим")
        demo_user("saule", "demo12345", role="technologist", first_name="Сауле")
        demo_user("marat", "demo12345", role="accountant", first_name="Марат")
        demo_user("bolat", "demo12345", role="worker", first_name="Болат")
        demo_user("dana", "demo12345", role="warehouse", first_name="Дана")
        ensure_default_stages()

        if Contract.objects.exists():
            self.stdout.write("Договоры уже есть — демо-данные не добавляются.")
            return

        today = timezone.localdate()
        own, _ = OwnCompany.objects.get_or_create(name="Каз Демеу")
        plats = {n: Platform.objects.get_or_create(name=n)[0] for n in ["госзакуп", "Самрук-Казына"]}

        # ── тендеры ──
        for pl, pno, org, item, qty, price, plan, cost, dl, st in [
            ("госзакуп", "17228455-1", "АО «Шығыс Жылу»", "Куртка для рабочих", 210, 17000, 16000, 11200, 2, "submitted"),
            ("Самрук-Казына", "1233176", "Теміржолсу-Маңғыстау", "Костюм рабочий", 90, 50488, 48000, 31500, 9, "planned"),
            ("госзакуп", "17292686-1", "АО «Аэропорт Шымкент»", "Костюм форменный", 93, 50000, 46000, 30200, -20, "lost"),
        ]:
            Tender.objects.create(platform=plats[pl], own_company=own, purchase_no=pno, customer_name=org,
                                  item_name=item, qty=qty, price=price, plan_price=plan, cost_per_unit=cost,
                                  deadline=today + timedelta(days=dl), status=st, manager=manager,
                                  delivery_days="60 календарных дней")

        pav = Customer.objects.create(name="ТОО «Павлодарская энергосетевая компания»")
        mvd = Customer.objects.create(name="Департамент полиции на транспорте")

        def contract(customer, pno, title, qty, price, days, status, **extra):
            c = Contract.objects.create(number=pno, purchase_no=pno, customer=customer, title=title,
                                        qty=qty, price=price, amount=qty * price, own_company=own,
                                        platform="госзакуп", status=status, manager=manager,
                                        signed_date=today - timedelta(days=40),
                                        deadline=today + timedelta(days=days), **extra)
            return c

        c1 = contract(pav, "16561301-1", "Куртка АУП утеплённая", 741, 18000, 25, "in_progress",
                      delivery_place="г. Павлодар", contract_no="741/26")
        c2 = contract(mvd, "15677814-1", "Костюм летний камуфляжной расцветки", 120, 24800, 50, "new",
                      delivery_place="г. Астана")
        Tender.objects.create(platform=plats["госзакуп"], own_company=own, purchase_no="16561301-1",
                              customer_name=pav.name, item_name=c1.title, qty=741, price=19000,
                              plan_price=18000, cost_per_unit=12500, status="won", contract=c1,
                              deadline=today - timedelta(days=50))

        for pos, (amount, comment) in enumerate([
            (45000, "образец"), (8500200, "ткани ашок из низ"), (15000, "дост ткани"),
            (832000, "фурн и тд"), (891500, "синтепон"), (538650, "крой"), (2000000, "вахид пошив"),
            (136900, "мешки упаковк"), (12000, "дост"),
        ], start=1):
            ContractExpense.objects.create(contract=c1, amount=amount, comment=comment,
                                           kind=classify(comment), position=pos,
                                           date=today - timedelta(days=35 - pos * 3))
        ContractPayment.objects.create(contract=c1, amount=6670000, comment="аванс 50%",
                                       date=today - timedelta(days=30))
        Comment.objects.create(contract=c1, author=manager, importance="important",
                               text="Заказчик просит логотип по новому брендбуку — уточнить до кроя.")

        # ── цех ──
        nasr = Brigade.objects.create(leader="Наср", people=9)
        akbar = Brigade.objects.create(leader="Акбар", people=2)
        order = WorkOrder.objects.create(product="Куртка АУП", contract=c1, client=pav.name,
                                         deadline=c1.deadline)
        set_route(order, StageTemplate.objects.filter(is_active=True).values_list("id", flat=True))
        rows, _ = parse_sizes("44/170 - 35\n46/176 - 45\n48/158 - 25\n54/176 - 10")
        apply_sizes(order, rows)
        stages = {s.template.name: s for s in order.stages.select_related("template")}
        sizes = {s.size: s for s in order.sizes.all()}

        def entry(stage, size, days_ago, qty, extra="", **mats):
            e = StageEntry.objects.create(stage=stages[stage], size=sizes[size], qty=qty, extra=extra,
                                          date=today - timedelta(days=days_ago))
            for k, v in mats.items():
                EntryMaterial.objects.create(entry=e, material=k, meters=Decimal(str(v)))

        entry("Крой", "44/170", 20, 35, основа=85.4, подклад=133.5, флис=38.5)
        entry("Крой", "46/176", 19, 45, основа=112.5, подклад=138, флис=45)
        entry("Крой", "48/158", 17, 25, основа=61.25, подклад=73.75)
        entry("Вышивка", "44/170", 16, 35, "карман")
        entry("Вышивка", "46/176", 15, 45, "полный")
        for size, brigade, qty, marks in [("44/170", nasr, 35, [(14, .3), (10, .7), (6, 1)]),
                                          ("46/176", akbar, 45, [(12, .2), (6, .5)])]:
            j = SewingJob.objects.create(stage=stages["Тигин"], size=sizes[size], brigade=brigade, qty=qty,
                                         started=today - timedelta(days=15))
            for d, r in marks:
                SewingProgress.objects.create(job=j, date=today - timedelta(days=d), ready=Decimal(str(r)))
        entry("Чистка", "44/170", 5, 35)
        entry("Упаковка", "44/170", 4, 30)

        # ── склад ──
        sup = Supplier.objects.create(name="ТОО Textile KZ", phone="+7 701 111 22 33")
        for name, unit, minst, qty, price in [("Ткань оксфорд (основа)", "м", 300, 1200, 1450),
                                              ("Подклад таффета", "м", 300, 900, 520),
                                              ("Молния 60 см", "шт", 200, 800, 180)]:
            m = Material.objects.create(name=name, unit=unit, min_stock=minst, default_supplier=sup)
            MaterialBatch.objects.create(material=m, supplier=sup, qty=qty, unit_price=price,
                                         received_at=today - timedelta(days=25), batch_no="B-10")
            StockMovement.objects.create(material=m, qty=-(qty * Decimal("0.6")), reason="production",
                                         work_order=order, note="Выдано на крой")

        # ── финансы ──
        for pos, (name, plan, lines) in enumerate([
            ("Оклад Алмата", 1500000, [(250000, "хайр {m}"), (125000, "мумин {m}"), (50000, "техн {m}")]),
            ("Аренда Алмата цех", 950000, [(919385, "аренда {m}"), (55764, "ком усл {m}")]),
        ]):
            cat = AdminCategory.objects.create(name=name, monthly_plan=plan, position=pos)
            for back in range(3):
                month = (today.replace(day=1) - timedelta(days=28 * back)).replace(day=1)
                for amount, text in lines:
                    AdminExpense.objects.create(category=cat, amount=amount, month=month,
                                                comment=text.format(m=month.strftime("%m.%Y")))
        OtherIncome.objects.create(amount=3000000, comment="вложение инвестора",
                                   date=today - timedelta(days=45))

        self.stdout.write(self.style.SUCCESS(
            "Демо-данные загружены. Логины: admin/admin12345, aigerim (менеджер), saule (технолог), "
            "marat (бухгалтер), bolat (цех), dana (склад) — пароль demo12345"))
