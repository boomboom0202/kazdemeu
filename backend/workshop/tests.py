from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from .calc import apply_sizes, parse_sizes
from .models import WorkOrder, WorkSize
from .sizes import normalize_size


class NormalizeSizeTests(TestCase):
    def test_one_writing_for_workshop_notations(self):
        for raw, canon in [
            ("54/176", "54/176"), ("54-188", "54/188"), ("52|194", "52/194"), ("48.182", "48/182"),
            ("44 /164", "44/164"), ("56_182", "56/182"), ("60/62-182/188", "60-62/182-188"),
            ("52-54,158-164", "52-54/158-164"), ("44/46-158/164", "44-46/158-164"),
            ("50", "50"), ("xl", "XL"), ("ХЛ", "XL"), ("XXL", "2XL"), ("Без размера", "без размера"),
        ]:
            self.assertEqual(normalize_size(raw), (canon, None), raw)

    def test_sizes_outside_the_grid_rejected(self):
        for raw in ["48/192", "47/176", "176/54", "90", "54/176/182/188", "50-60/176", "54/170-188", "размер", ""]:
            size, err = normalize_size(raw)
            self.assertIsNone(size, raw)
            self.assertTrue(err, raw)
        self.assertIn("188 или 194", normalize_size("48/192")[1])


class ParseSizesTests(TestCase):
    def test_rows_and_errors(self):
        rows, errors = parse_sizes("54/176 - 27 шт\n56-58/170-176 116шт\n54-176 3\n50 164\n48/192 - 4\nбез размера 980")
        self.assertEqual(rows, [("54/176", 27), ("56-58/170-176", 116), ("без размера", 980)])
        self.assertEqual(len(errors), 3)
        self.assertIn("уже есть в строке 1", errors[0])   # 54-176 — тот же 54/176
        self.assertIn("50/164", errors[1])                 # размер без количества или количество?
        self.assertIn("роста 192", errors[2])

    def test_quantity_without_ambiguity(self):
        # 10 — не рост, значит количество; тире или «шт» снимают вопрос «размер/рост или штуки»
        self.assertEqual(parse_sizes("50 10"), ([("50", 10)], []))
        self.assertEqual(parse_sizes("50 - 164 шт\nXL 5"), ([("50", 164), ("XL", 5)], []))


class ApplySizesTests(TestCase):
    def tearDown(self):
        # запрос через API запоминает пользователя для журнала — после отката базы его уже нет
        from accounts.audit import set_current_user
        set_current_user(None)

    def test_old_writing_is_recognised_and_rows_sorted(self):
        order = WorkOrder.objects.create(product="Китель")
        WorkSize.objects.create(order=order, size="58-182", planned=5, position=0)
        rows, _ = parse_sizes("58/182 - 7\n44/170 - 3")
        self.assertEqual(apply_sizes(order, rows), (1, 1))
        self.assertEqual(list(order.sizes.order_by("position").values_list("size", "planned")),
                         [("44/170", 3), ("58/182", 7)])

    def test_api_normalises_and_validates(self):
        user = get_user_model().objects.create_superuser("sz", password="x")
        client = APIClient()
        client.force_authenticate(user)
        order = WorkOrder.objects.create(product="Китель")
        r = client.post(f"/api/work-orders/{order.id}/sizes_bulk/", {"text": "54-188 - 2"}, format="json")
        self.assertEqual((r.status_code, r.data["report"]), (200, {"added": 1, "updated": 0}))
        self.assertEqual(order.sizes.get().size, "54/188")
        r = client.post(f"/api/work-orders/{order.id}/sizes_bulk/", {"text": "48/192 - 1"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("роста 192", r.data["detail"])
        r = client.post("/api/work-sizes/", {"order": order.id, "size": "48/192", "planned": 1}, format="json")
        self.assertEqual(r.status_code, 400)
        r = client.post("/api/work-sizes/", {"order": order.id, "size": "56_182", "planned": 1}, format="json")
        self.assertEqual((r.status_code, r.data["size"]), (201, "56/182"))
