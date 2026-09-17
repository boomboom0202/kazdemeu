"""Один полный цикл работы — так, как его ведут сотрудники разных ролей.

    python manage.py seed_cycle --users   # завести сотрудников всех ролей и пройти цикл
    python manage.py seed_cycle           # пройти цикл силами уже заведённых сотрудников

Каждый шаг делает сотрудник своей роли теми же запросами, что шлёт
интерфейс, поэтому в журнале действий, в карточках и записях этапов видно,
кто что сделал:
  администратор — заводит сотрудников;
  менеджер      — ведёт лот и договор;
  директор      — принимает решение по лоту: «выиграли»;
  бухгалтер     — оплаты заказчика, расходы договора, административные расходы;
  технолог      — запускает цех, кроит, выдаёт партии в пошив;
  сотрудник цеха — вышивка, готовность пошива, чистка, упаковка;
  кладовщик     — ткань: приход и выдача в цех, отгрузка готового;
  просмотр      — всё видит, изменить ничего не может.

Заказ нарочно остановлен на середине: часть размеров отгружена, часть
шьётся, часть только скроена.
"""
import secrets
from collections import OrderedDict
from datetime import timedelta
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

# роль, логин, имя — администратор не заводится: это ваша учётная запись
STAFF = [
    ("director", "director", "Серик"),
    ("manager", "manager", "Айгерим"),
    ("technologist", "technolog", "Айбек"),
    ("accountant", "buhgalter", "Гульнара"),
    ("warehouse", "sklad", "Данияр"),
    ("worker", "ceh", "Мадина"),
    ("viewer", "prosmotr", "Асель"),
]
ROLE_LABEL = OrderedDict([
    ("admin", "Администратор"), ("manager", "Менеджер"), ("director", "Директор"),
    ("accountant", "Бухгалтер"), ("technologist", "Технолог"), ("warehouse", "Кладовщик"),
    ("worker", "Сотрудник цеха"), ("viewer", "Только просмотр"),
])

PRODUCT = "Куртка рабочая утеплённая"
# размер, план, крой, вышивка, (в пошив, готовность), чистка, упаковка, отгружено
PLAN = [
    ("48/176", 20, 20, 20, (20, "1"), 20, 20, 20),
    ("50/176", 30, 30, 30, (30, "1"), 30, 30, 20),
    ("52/182", 35, 35, 35, (35, "0.6"), 21, 15, 0),
    ("54/182", 30, 30, 30, (30, "0.3"), 0, 0, 0),
    ("56/188", 20, 20, 10, None, 0, 0, 0),
    ("58/188", 15, 15, 0, None, 0, 0, 0),
]
CUT_MATERIALS = {"основа": 2.6, "подклад": 2.2, "синтепон": 1.8}   # метров на штуку


class Command(BaseCommand):
    help = "Один полный цикл: тендер → договор → цех → склад → финансы, каждый шаг — своей ролью"

    def add_arguments(self, parser):
        parser.add_argument("--users", action="store_true",
                            help="сначала завести сотрудников всех ролей с новыми паролями")

    def handle(self, *args, **opts):
        from django.conf import settings
        from accounts.models import User
        from contracts.models import Contract

        self.admin = (User.objects.filter(is_superuser=True, is_active=True).order_by("id").first()
                      or User.objects.filter(role="admin", is_active=True).order_by("id").first())
        if not self.admin:
            raise CommandError("Нет администратора — некому заводить сотрудников.")
        if Contract.objects.exists():
            raise CommandError("В базе уже есть договоры. Сначала очистка: manage.py wipe_data --yes-i-am-sure")
        hosts = [h for h in settings.ALLOWED_HOSTS if h != "*"]
        self.host = hosts[0].lstrip(".") if hosts else "testserver"
        self.today = timezone.localdate()
        self.calls = 0
        self.did = OrderedDict((r, []) for r in ROLE_LABEL)
        self.users = {}

        passwords = self.create_staff() if opts["users"] else {}
        for role in ROLE_LABEL:
            self.users[role] = (User.objects.filter(role=role, is_active=True).order_by("id").first()
                                if role != "admin" else self.admin)
        missing = [ROLE_LABEL[r] for r, u in self.users.items() if u is None]
        if missing:
            raise CommandError("Нет сотрудников ролей: " + ", ".join(missing) + ". Запустите с --users.")

        self.cycle()
        self.report(passwords)

    # ── запросы от имени сотрудника роли ──────────────────────────────────
    def call(self, role, method, url, data=None, what="", expect_ok=True):
        from rest_framework.test import APIClient
        client = APIClient(HTTP_HOST=self.host)
        client.force_authenticate(self.users.get(role) or self.admin)
        r = getattr(client, method)(f"/api{url}", data, format="json") if data is not None \
            else getattr(client, method)(f"/api{url}")
        self.calls += 1
        if expect_ok and r.status_code >= 400:
            raise CommandError(f"{ROLE_LABEL[role]}: {what or url} → {r.status_code}: {getattr(r, 'data', r.content)}")
        return r

    def post(self, role, url, data=None, what=""):
        return self.call(role, "post", url, data or {}, what).data

    def done(self, role, text):
        self.did[role].append(text)

    def days(self, n):
        return str(self.today - timedelta(days=n))

    def month(self, back):
        d = self.today.replace(day=1)
        for _ in range(back):
            d = (d - timedelta(days=1)).replace(day=1)
        return str(d)

    # ── администратор: сотрудники ────────────────────────────────────────
    def create_staff(self):
        from accounts.models import User
        self.users["admin"] = self.admin
        passwords = {}
        for role, login, name in STAFF:
            if User.objects.filter(username=login).exists():
                raise CommandError(f"Логин «{login}» уже занят. Для нового набора: wipe_data --yes-i-am-sure --users")
            password = f"{login.capitalize()}-{secrets.token_hex(3)}"
            self.post("admin", "/users/", {"username": login, "password": password, "first_name": name,
                                          "role": role, "is_active": True}, f"сотрудник {login}")
            passwords[login] = (role, name, password)
        self.done("admin", f"сотрудники заведены: {', '.join(login for _, login, _ in STAFF)}")
        return passwords

    # ── цикл ─────────────────────────────────────────────────────────────
    def cycle(self):
        from workshop.models import ensure_default_stages
        ensure_default_stages()
        U = self.users

        # 1. менеджер заводит лот и подаёт заявку
        platform = self.post("manager", "/platforms/", {"name": "госзакуп"}, "площадка")
        company = self.post("manager", "/own-companies/", {"name": "ТОО «Каз Демеу»"}, "своя фирма")
        tender = self.post("manager", "/tenders/", {
            "platform": platform["id"], "own_company": company["id"], "purchase_no": "17451203-1",
            "customer_name": "ТОО «Павлодарская энергосетевая компания»", "item_name": PRODUCT,
            "qty": 150, "price": 25000, "plan_price": 24000, "cost_per_unit": 13500,
            "deadline": self.days(35), "delivery_days": "60 календарных дней", "manager": U["manager"].id,
            "note": "Спецодежда для линейного персонала",
        }, "лот")
        self.post("manager", f"/tenders/{tender['id']}/set_status/", {"status": "submitted"}, "заявка подана")
        self.done("manager", f"лот {tender['purchase_no']} «{PRODUCT}», 150 шт — заведён, заявка подана")

        # 2. директор принимает решение
        self.post("director", f"/tenders/{tender['id']}/set_status/", {"status": "won"}, "выиграли")
        self.done("director", "решение по тендеру: лот «Выиграли»")

        # 3. менеджер заводит договор
        cid = self.post("manager", f"/tenders/{tender['id']}/make_contract/", {"deadline": self.days(-40)},
                        "договор из лота")["contract_id"]
        self.call("manager", "patch", f"/contracts/{cid}/", {
            "contract_no": "150/26", "signed_date": self.days(24), "delivery_place": "г. Павлодар",
            "phone": "+7 718 255 00 00"}, "реквизиты")
        self.post("manager", f"/contracts/{cid}/set_status/", {"status": "in_progress"}, "в работу")
        self.post("manager", "/comments/", {"contract": cid, "importance": "important",
                                            "text": "Заказчик просит логотип на спине по новому брендбуку."}, "комментарий")
        self.done("manager", "договор из лота, реквизиты (№150/26), статус «В работе», "
                             "важный комментарий заказчика")

        # 4. бухгалтер: аванс и расходы на закупку
        self.post("accountant", "/contract-payments/", {"contract": cid, "amount": 1800000,
                                                        "comment": "аванс 50%", "date": self.days(22)}, "аванс")
        expenses = [(1150000, "ткань оксфорд 900 м", "fabric", 21), (390000, "утеплитель и подклад", "fabric", 20),
                    (240000, "фурнитура: молнии, шевроны", "accessories", 19), (160000, "крой", "sewing", 14)]
        for amount, comment, kind, back in expenses:
            self.post("accountant", "/contract-expenses/", {"contract": cid, "amount": amount, "comment": comment,
                                                            "kind": kind, "date": self.days(back)}, "расход")
        self.done("accountant", "аванс 1 800 000 и первые расходы договора: ткань, утеплитель, фурнитура, крой")

        # 5. технолог запускает цех
        templates = self.call("technologist", "get", "/stage-templates/?page_size=100").data["results"]
        order = self.post("technologist", "/work-orders/", {
            "product": PRODUCT, "contract": cid, "deadline": self.days(-40),
            "sizes_text": "\n".join(f"{s[0]} - {s[1]}" for s in PLAN),
            "template_ids": [t["id"] for t in templates if t["is_active"]]}, "заказ цеха")
        oid = order["id"]
        detail = self.call("technologist", "get", f"/work-orders/{oid}/").data
        stages = {s["name"]: s["id"] for s in detail["stages"]}
        sizes = {s["size"]: s["id"] for s in detail["sizes"]}
        self.done("technologist", f"договор запущен в цех: {len(sizes)} размеров, 150 шт, этапы "
                                  + " → ".join(stages))

        # 6. кладовщик: ткань пришла и выдана в цех под заказ
        supplier = self.post("warehouse", "/suppliers/", {"name": "ТОО «Textile KZ»", "phone": "+7 701 111 22 33"})
        for name, unit, min_stock, qty, price, issued in [
            ("Ткань оксфорд (основа)", "м", 300, 900, 1270, 390),
            ("Подклад таффета", "м", 300, 700, 330, 330),
            ("Синтепон 200", "м", 200, 600, 260, 270),
        ]:
            m = self.post("warehouse", "/materials/", {"name": name, "unit": unit, "min_stock": min_stock,
                                                       "default_supplier": supplier["id"]})
            self.post("warehouse", "/material-batches/", {"material": m["id"], "supplier": supplier["id"], "qty": qty,
                                                          "unit_price": price, "batch_no": "B-26-04",
                                                          "received_at": self.days(20)}, "приход")
            self.post("warehouse", "/stock-movements/", {"material": m["id"], "qty": -issued, "reason": "production",
                                                         "work_order": oid, "note": "Выдано на крой"}, "выдача")
        self.done("warehouse", "ткань от поставщика принята (3 материала) и выдана в цех под заказ")

        # 7. технолог кроит и раздаёт партии в пошив; сотрудник цеха — вышивка, готовность, чистка, упаковка
        crews = ["Наср + 9", "Акбар + 2"]
        for i, (size, _plan, cut, emb, sewing, clean, pack, _ship) in enumerate(PLAN):
            self.post("technologist", "/stage-entries/", {
                "stage": stages["Крой"], "size": sizes[size], "qty": cut, "date": self.days(17 - i),
                "responsible": U["technologist"].id, "workers": "Ербол",
                "materials": [{"material": k, "meters": round(v * cut, 1)} for k, v in CUT_MATERIALS.items()]},
                f"крой {size}")
            if emb:
                self.post("worker", "/stage-entries/", {
                    "stage": stages["Вышивка"], "size": sizes[size], "qty": emb, "extra": "полный",
                    "date": self.days(14 - i), "responsible": U["worker"].id, "workers": "Гульмира"}, f"вышивка {size}")
            if sewing:
                qty, ready = sewing
                job = self.post("technologist", "/sewing-jobs/", {
                    "stage": stages["Тигин"], "size": sizes[size], "qty": qty, "started": self.days(12 - i),
                    "responsible": U["technologist"].id, "workers": crews[i % 2]}, f"партия {size}")
                self.post("worker", f"/sewing-jobs/{job['id']}/progress/", {"date": self.days(8 - i), "ready": "0.3"})
                self.post("worker", f"/sewing-jobs/{job['id']}/progress/", {"date": self.days(3), "ready": ready})
            if clean:
                self.post("worker", "/stage-entries/", {"stage": stages["Чистка"], "size": sizes[size], "qty": clean,
                                                        "date": self.days(2), "responsible": U["worker"].id,
                                                        "workers": "Гульмира"}, f"чистка {size}")
            if pack:
                self.post("worker", "/stage-entries/", {"stage": stages["Упаковка"], "size": sizes[size], "qty": pack,
                                                        "date": self.days(1), "responsible": U["worker"].id,
                                                        "workers": "Айгуль"}, f"упаковка {size}")
        self.done("technologist", "крой всех размеров (150 шт, метраж по основе, подкладу и синтепону), "
                                  "4 партии выданы в пошив бригадам Наср + 9 и Акбар + 2")
        self.done("worker", "вышивка 125 шт, отметки готовности партий, чистка 71 шт, упаковка 65 шт")

        # 8. кладовщик отгружает готовое
        for size, *rest in PLAN:
            if rest[-1]:
                self.post("warehouse", "/goods-movements/", {"kind": "out", "work_order": oid, "contract": cid,
                                                             "product": PRODUCT, "size": size, "qty": rest[-1],
                                                             "date": self.today.isoformat(),
                                                             "note": "Накладная №41, г. Павлодар"}, f"отгрузка {size}")
        self.done("warehouse", "отгрузка заказчику 40 курток (48/176 и 50/176), 25 шт на складе")

        # 9. бухгалтер: остальные расходы договора, оплата после отгрузки, административные расходы
        for amount, comment, kind, back in [(420000, "пошив, бригады Наср и Акбар", "sewing", 4),
                                            (60000, "упаковка, мешки", "packaging", 2),
                                            (45000, "доставка до Павлодара", "delivery", 0)]:
            self.post("accountant", "/contract-expenses/", {"contract": cid, "amount": amount, "comment": comment,
                                                            "kind": kind, "date": self.days(back)}, "расход")
        self.post("accountant", "/contract-payments/", {"contract": cid, "amount": 600000,
                                                        "comment": "оплата за первую отгрузку",
                                                        "date": self.today.isoformat()}, "оплата")
        cats = {}
        for name, plan in [("Оклады", 450000), ("Аренда цеха", 150000), ("Связь и интернет", 25000)]:
            cats[name] = self.post("accountant", "/admin-categories/", {"name": name, "monthly_plan": plan})["id"]
        for back, name, amount, comment in [(1, "Аренда цеха", 150000, "аренда цех"),
                                            (0, "Оклады", 450000, "оклады"),
                                            (0, "Аренда цеха", 150000, "аренда цех"),
                                            (0, "Связь и интернет", 22000, "связь, интернет")]:
            month = self.month(back)
            self.post("accountant", "/admin-expenses/", {"category": cats[name], "amount": amount, "month": month,
                                                         "comment": f"{comment} {month[5:7]}.{month[:4]}"})
        self.done("accountant", "остальные расходы договора (пошив, упаковка, доставка), оплата 600 000 за отгрузку, "
                                "административные расходы: оклады, аренда, связь")

        # 10. просмотр: видит, но изменить не может
        seen = self.call("viewer", "get", "/contracts/").status_code
        denied = self.call("viewer", "post", "/contract-expenses/", {"contract": cid, "amount": 1}, expect_ok=False)
        if seen != 200 or denied.status_code != 403:
            raise CommandError(f"Права «только просмотр» работают не так: чтение {seen}, запись {denied.status_code}")
        self.done("viewer", "договоры и цех открываются; попытка добавить расход — отказ, как и должно быть")
        self.cid, self.oid = cid, oid

    # ── итог ─────────────────────────────────────────────────────────────
    def report(self, passwords):
        out = self.stdout
        c = self.call("admin", "get", f"/contracts/{self.cid}/").data
        m = c["money"]
        fin = self.call("admin", "get", "/finance/summary/").data
        s = self.call("admin", "get", f"/work-orders/{self.oid}/").data["summary"]

        if passwords:
            out.write("\nСОТРУДНИКИ (пароли — сохраните и передайте людям)")
            for login, (role, name, password) in passwords.items():
                out.write(f"  {ROLE_LABEL[role]:16} {name:9} логин {login:10} пароль {password}")
        out.write("\nКТО ЧТО СДЕЛАЛ")
        for role, items in self.did.items():
            user = self.users.get(role)
            who = f"{ROLE_LABEL[role]} ({user.username})" if user else ROLE_LABEL[role]
            for text in items:
                out.write(f"  {who}: {text}")
        out.write("\nИТОГ")
        out.write(f"  договор {c['number']}: сумма {c['amount']}, оплачено {m['paid']}, долг {m['debt']}")
        out.write(f"  расходы договора {m['expenses']}, прибыль {m['profit']}, "
                  f"доля административных {m['admin_share']}, чистая прибыль {m['net_profit']}")
        out.write(f"  цех: план {s['planned']}, " + ", ".join(f"{st['name']} {st['done']}" for st in s["stages"])
                  + f", осталось {s['left']}")
        out.write(f"  финансы: административные {fin['admin_expenses']}, потрачено всего {fin['spent_total']}, "
                  f"деньги сейчас {fin['cash']}")
        out.write(self.style.SUCCESS(f"\nГотово: {self.calls} запросов к API, ни одного отказа."))
