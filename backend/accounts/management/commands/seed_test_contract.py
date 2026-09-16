"""Тестовый прогон: один договор от тендера до отгрузки.

Данные создаются теми же запросами, что шлёт интерфейс, поэтому команда
заодно проверяет, что на сервере работает вся цепочка: права, проверки
этапов цеха, пересчёт денег договора, склад и сводки финансов.

    python manage.py seed_test_contract          # создать и показать сводку
    python manage.py seed_test_contract --check  # ничего не создавать, только сводка

Заказ нарочно остановлен на середине: часть размеров прошла все этапы и
отгружена, часть шьётся, часть только скроена — чтобы было видно, как
считаются «прошло», «шьётся» и «осталось».
"""
from datetime import timedelta
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

# размер, план, крой, вышивка, (выдано в пошив, готовность), чистка, упаковка, отгружено
PLAN = [
    ("48/176", 20, 20, 20, (20, "1"), 20, 20, 20),
    ("50/176", 30, 30, 30, (30, "1"), 30, 30, 20),
    ("52/182", 35, 35, 35, (35, "0.6"), 21, 15, 0),
    ("54/182", 30, 30, 30, (30, "0.3"), 0, 0, 0),
    ("56/188", 20, 20, 10, None, 0, 0, 0),
    ("58/188", 15, 15, 0, None, 0, 0, 0),
]
# ткань на крой: метров на весь размер
CUT_MATERIALS = {"основа": 2.6, "подклад": 2.2, "синтепон": 1.8}


class Command(BaseCommand):
    help = "Создать тестовый договор и прогнать его по всему пути: тендер → цех → склад → финансы"

    def add_arguments(self, parser):
        parser.add_argument("--check", action="store_true",
                            help="ничего не создавать, только показать сводку по тестовому договору")

    def handle(self, *args, **opts):
        from rest_framework.test import APIClient
        from accounts.models import User
        from contracts.models import Contract

        user = (User.objects.filter(is_superuser=True, is_active=True).first()
                or User.objects.filter(role="admin", is_active=True).first())
        if not user:
            raise CommandError("Нет администратора — некому заводить данные.")
        # на сервере ALLOWED_HOSTS не знает служебный «testserver» — берём разрешённый хост
        from django.conf import settings
        hosts = [h for h in settings.ALLOWED_HOSTS if h != "*"]
        self.client = APIClient(HTTP_HOST=hosts[0].lstrip(".") if hosts else "testserver")
        self.client.force_authenticate(user)
        self.calls = 0
        self.today = timezone.localdate()

        if opts["check"]:
            contract = Contract.objects.order_by("-id").first()
            if not contract:
                raise CommandError("Договоров нет.")
            return self.report(contract.id)

        if Contract.objects.exists():
            raise CommandError("В базе уже есть договоры. Сначала очистка: "
                               "manage.py wipe_data --yes-i-am-sure")

        contract_id = self.build()
        self.report(contract_id)
        self.stdout.write(self.style.SUCCESS(f"\nГотово: {self.calls} запросов к API прошли без ошибок."))

    # ── запросы ───────────────────────────────────────────────────────────
    def post(self, url, data=None, what=""):
        r = self.client.post(f"/api{url}", data or {}, format="json")
        if r.status_code >= 400:
            raise CommandError(f"{what or url} → {r.status_code}: {getattr(r, 'data', r.content)}")
        self.calls += 1
        return r.data

    def patch(self, url, data, what=""):
        r = self.client.patch(f"/api{url}", data, format="json")
        if r.status_code >= 400:
            raise CommandError(f"{what or url} → {r.status_code}: {getattr(r, 'data', r.content)}")
        self.calls += 1
        return r.data

    def get(self, url, what=""):
        r = self.client.get(f"/api{url}")
        if r.status_code >= 400:
            raise CommandError(f"{what or url} → {r.status_code}: {getattr(r, 'data', r.content)}")
        self.calls += 1
        return r.data

    def step(self, text):
        self.stdout.write(f"  {text}")

    def days(self, n):
        return str(self.today - timedelta(days=n))

    # ── цепочка ───────────────────────────────────────────────────────────
    def build(self):
        from workshop.models import ensure_default_stages
        ensure_default_stages()

        # 1. тендер
        platform = self.post("/platforms/", {"name": "госзакуп"}, "площадка")
        company = self.post("/own-companies/", {"name": "Каз Демеу"}, "своя фирма")
        tender = self.post("/tenders/", {
            "platform": platform["id"], "own_company": company["id"], "purchase_no": "17451203-1",
            "customer_name": "ТОО «Павлодарская энергосетевая компания»",
            "item_name": "Куртка рабочая утеплённая", "qty": 150, "price": 21000,
            "plan_price": 21000, "cost_per_unit": 13400, "delivery_days": "60 календарных дней",
            "deadline": self.days(-30), "note": "Тестовый лот",
        }, "тендер")
        for status in ("submitted", "won"):
            tender = self.post(f"/tenders/{tender['id']}/set_status/", {"status": status}, f"тендер → {status}")
        self.step(f"тендер {tender['purchase_no']}: {tender['status_display']}, "
                  f"на {tender['customer_total']} ₸")

        # 2. договор из тендера
        cid = self.post(f"/tenders/{tender['id']}/make_contract/",
                        {"deadline": self.days(-45)}, "договор из тендера")["contract_id"]
        contract = self.patch(f"/contracts/{cid}/", {
            "contract_no": "150/26", "signed_date": self.days(20), "delivery_place": "г. Павлодар",
            "comment": "Тестовый договор: полный путь от тендера до отгрузки.",
        }, "реквизиты договора")
        self.post(f"/contracts/{cid}/set_status/", {"status": "in_progress"}, "договор в работу")
        self.step(f"договор {contract['number']}: {contract['title']}, {contract['qty']} шт")

        # 3. деньги договора
        for amount, comment, back in [(1575000, "аванс 50%", 18), (500000, "промежуточная оплата", 6)]:
            self.post("/contract-payments/", {"contract": cid, "amount": amount,
                                              "comment": comment, "date": self.days(back)}, "оплата")
        for amount, comment, kind, back in [
            (980_000, "ткань оксфорд, 900 м", "fabric", 17),
            (360_000, "утеплитель и подклад", "fabric", 16),
            (210_000, "фурнитура: молнии, шевроны", "accessories", 15),
            (150_000, "крой", "sewing", 12),
            (320_000, "пошив, бригада Наср", "sewing", 6),
            (55_000, "упаковка, мешки", "packaging", 4),
            (35_000, "доставка до Павлодара", "delivery", 2),
        ]:
            self.post("/contract-expenses/", {"contract": cid, "amount": amount, "comment": comment,
                                              "kind": kind, "date": self.days(back)}, "расход")
        self.step("оплаты и расходы записаны")

        # 4. заказ цеха со всеми этапами
        templates = self.get("/stage-templates/?page_size=100", "этапы")["results"]
        order = self.post("/work-orders/", {
            "product": "Куртка рабочая утеплённая", "contract": cid, "deadline": self.days(-45),
            "sizes_text": "\n".join(f"{s[0]} - {s[1]}" for s in PLAN),
            "template_ids": [t["id"] for t in templates if t["is_active"]],
        }, "заказ цеха")
        oid = order["id"]
        detail = self.get(f"/work-orders/{oid}/", "карточка заказа")
        stages = {s["name"]: s["id"] for s in detail["stages"]}
        sizes = {s["size"]: s["id"] for s in detail["sizes"]}
        self.step(f"заказ цеха: {len(sizes)} размеров, этапы — {', '.join(stages)}")

        # 5. бригады и работа по этапам
        brigades = [self.post("/brigades/", {"leader": leader, "people": people}, "бригада")
                    for leader, people in [("Наср", 9), ("Акбар", 2)]]
        # исполнители на штучных этапах — те же карточки справочника, но без людей в бригаде
        workers = {name: self.post("/brigades/", {"leader": name, "people": 0,
                                                  "note": note}, "исполнитель")["id"]
                   for name, note in [("Ербол", "закройщик"), ("Гульмира", "вышивка и чистка"),
                                      ("Айгуль", "упаковка")]}
        for i, (size, plan, cut, embroidery, sewing, clean, pack, _ship) in enumerate(PLAN):
            if cut:
                self.post("/stage-entries/", {
                    "stage": stages["Крой"], "size": sizes[size], "qty": cut, "date": self.days(20 - i),
                    "brigade": workers["Ербол"], "materials": [{"material": m, "meters": round(per * cut, 1)}
                                                               for m, per in CUT_MATERIALS.items()],
                }, f"крой {size}")
            if embroidery:
                self.post("/stage-entries/", {"stage": stages["Вышивка"], "size": sizes[size],
                                              "qty": embroidery, "extra": "полный",
                                              "brigade": workers["Гульмира"],
                                              "date": self.days(16 - i)}, f"вышивка {size}")
            if sewing:
                qty, ready = sewing
                job = self.post("/sewing-jobs/", {
                    "stage": stages["Тигин"], "size": sizes[size], "brigade": brigades[i % 2]["id"],
                    "qty": qty, "started": self.days(14 - i)}, f"партия {size}")
                self.post(f"/sewing-jobs/{job['id']}/progress/",
                          {"date": self.days(10 - i), "ready": "0.3"}, f"готовность {size}")
                self.post(f"/sewing-jobs/{job['id']}/progress/",
                          {"date": self.days(4), "ready": ready}, f"готовность {size}")
            if clean:
                self.post("/stage-entries/", {"stage": stages["Чистка"], "size": sizes[size],
                                              "qty": clean, "brigade": workers["Гульмира"],
                                              "date": self.days(3)}, f"чистка {size}")
            if pack:
                self.post("/stage-entries/", {"stage": stages["Упаковка"], "size": sizes[size],
                                              "qty": pack, "brigade": workers["Айгуль"],
                                              "date": self.days(2)}, f"упаковка {size}")
        self.step("цех: у каждой записи указано, кто делал; пошив — по бригадам")

        # 6. склад: ткань приходом и выдачей в цех
        supplier = self.post("/suppliers/", {"name": "ТОО Textile KZ", "phone": "+7 701 111 22 33"}, "поставщик")
        for name, unit, min_stock, qty, price, issued in [
            ("Ткань оксфорд (основа)", "м", 300, 900, 1450, 390),
            ("Подклад таффета", "м", 300, 700, 520, 330),
            ("Синтепон 200", "м", 200, 600, 780, 270),
        ]:
            material = self.post("/materials/", {"name": name, "unit": unit, "min_stock": min_stock,
                                                 "default_supplier": supplier["id"]}, "материал")
            self.post("/material-batches/", {"material": material["id"], "supplier": supplier["id"],
                                             "qty": qty, "unit_price": price, "batch_no": "B-26-04",
                                             "received_at": self.days(22)}, "приход ткани")
            self.post("/stock-movements/", {"material": material["id"], "qty": -issued,
                                            "reason": "production", "work_order": oid,
                                            "note": "Выдано на крой"}, "выдача в цех")

        # 7. отгрузка готового заказчику
        for size, *_rest in PLAN:
            ship = _rest[-1]
            if ship:
                self.post("/goods-movements/", {"kind": "out", "work_order": oid, "contract": cid,
                                                "product": "Куртка рабочая утеплённая", "size": size,
                                                "qty": ship, "date": self.days(1),
                                                "note": "Отгружено заказчику"}, f"отгрузка {size}")
        self.step("склад: ткань оприходована и выдана, готовое частично отгружено")
        return cid

    # ── сводка: те же цифры, что видно на страницах ───────────────────────
    def report(self, cid):
        c = self.get(f"/contracts/{cid}/", "договор")
        order = c["work_orders"][0] if c.get("work_orders") else None
        w = self.get(f"/work-orders/{order['id']}/", "заказ цеха") if order else None
        goods = self.get("/goods-movements/stock/", "готовая продукция")
        fin = self.get("/finance/summary/", "сводка финансов")
        an = self.get("/analytics/overview/", "аналитика")
        stock = self.get("/materials/?page_size=100", "материалы")["results"]

        out = self.stdout
        out.write("\nДОГОВОР")
        out.write(f"  {c['number']} · {c['customer_name']} · {c['title']}")
        m = c["money"]
        out.write(f"  сумма {c['amount']} · оплачено {m['paid']} · долг {m['debt']}")
        out.write(f"  расходы {m['expenses']} · прибыль {m['profit']} · остаток денег {m['balance']}")
        if w:
            s = w["summary"]
            out.write("\nЦЕХ")
            out.write(f"  {w['product']}: план {s['planned']} шт, осталось {s['left']}")
            for st in s["stages"]:
                extra = f", шьётся {st['in_work']}" if st.get("in_work") else ""
                out.write(f"    {st['name']}: прошло {st['done']}{extra}")
            for b in w["brigades"]:
                out.write(f"    бригада {b['label']}: выдано {b['assigned']}, сшито {b['sewn']}")
            out.write("  кто что сделал:")
            for b in self.get("/brigades/?page_size=100", "бригады")["results"]:
                st = b["stats"]
                work = " · ".join(f"{x['name']} {x['qty']}" for x in st["by_stage"])
                sewn = f"пошив {st['sewn']}" if st["sewn"] else ""
                out.write(f"    {b['label']}: {' · '.join(x for x in (sewn, work) if x) or '—'}")
        out.write("\nСКЛАД")
        for line in goods:
            out.write(f"  {line['product']} {line['size']}: из цеха {line['made']}, "
                      f"отгружено {line['shipped']}, на складе {line['stock']}")
        for m in stock:
            out.write(f"  {m['name']}: остаток {m['stock']} {m['unit']}")
        out.write("\nФИНАНСЫ")
        out.write(f"  получено {fin['paid']} · долг заказчиков {fin['debt']}")
        out.write(f"  расходы договоров {fin['contract_expenses']} · административные {fin['admin_expenses']}")
        out.write(f"  деньги сейчас {fin['cash']} · прибыль договоров {fin['contracts_profit']}")
        statuses = ", ".join(f"{s['label']} {s['count']}" for s in an["contracts"]["by_status"] if s["count"])
        out.write(f"  аналитика открывается: тендеров {an['tenders']['total']}, договоры — {statuses}")
