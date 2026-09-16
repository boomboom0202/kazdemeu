from decimal import Decimal
from rest_framework import serializers
from .calc import (job_ready, job_sewn, order_summary, size_summary, free_capacity, parse_sizes,
                   apply_sizes, set_route)
from .models import (StageTemplate, WorkOrder, WorkOrderStage, WorkSize, StageEntry,
                     EntryMaterial, SewingJob, SewingProgress)


def _num(v):
    return float(round(Decimal(v), 2))


def who(obj):
    """Кто отвечает и кто делал руками: «Сауле · Наср + 9»."""
    user = obj.responsible
    name = (user.get_full_name() or user.username) if user else ""
    return " · ".join(x for x in (name, obj.workers) if x)


class StageTemplateSerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    orders_count = serializers.SerializerMethodField()

    class Meta:
        model = StageTemplate
        fields = "__all__"

    def get_orders_count(self, obj):
        return obj.order_stages.count()

    def create(self, validated_data):
        # новый этап встаёт в конец, если место не указано явно
        if "position" not in self.initial_data:
            from django.db.models import Max
            top = StageTemplate.objects.aggregate(m=Max("position"))["m"]
            validated_data["position"] = 0 if top is None else top + 1
        return super().create(validated_data)

    def validate_kind(self, value):
        # Вид листа меняет смысл записей: крой с метражом не превратить
        # в партии бригад. Пока по этапу есть записи, вид не меняется.
        if self.instance and self.instance.kind != value and (
                StageEntry.objects.filter(stage__template=self.instance).exists()
                or SewingJob.objects.filter(stage__template=self.instance).exists()):
            raise serializers.ValidationError(
                "По этому этапу уже есть записи — вид листа поменять нельзя. "
                "Заведите новый этап.")
        return value


class WorkSizeSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkSize
        fields = "__all__"
        read_only_fields = ["position"]

    def validate_size(self, value):
        from .sizes import normalize_size
        size, err = normalize_size(value)
        if err:
            raise serializers.ValidationError(err)
        return size

    def save(self, **kwargs):
        from .calc import resort_sizes
        obj = super().save(**kwargs)
        resort_sizes(obj.order)
        return obj


class WorkOrderSerializer(serializers.ModelSerializer):
    contract_number = serializers.SerializerMethodField()
    customer_name = serializers.CharField(source="contract.customer.name", read_only=True, default=None)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    summary = serializers.SerializerMethodField()
    sizes_count = serializers.SerializerMethodField()
    # Сетка размеров столбиком: «54/176 - 27 шт»
    sizes_text = serializers.CharField(write_only=True, required=False, allow_blank=True)
    # Этапы заказа; не указаны — все этапы, включённые в настройках цеха
    template_ids = serializers.ListField(child=serializers.IntegerField(), write_only=True,
                                         required=False)

    class Meta:
        model = WorkOrder
        fields = "__all__"

    def get_contract_number(self, obj):
        c = obj.contract
        return (c.purchase_no or c.number) if c else None

    def get_summary(self, obj):
        return order_summary(obj)

    def get_sizes_count(self, obj):
        return len(obj.sizes.all())

    def validate_sizes_text(self, value):
        rows, errors = parse_sizes(value)
        if errors:
            raise serializers.ValidationError(errors)
        self._size_rows = rows
        return value

    def validate_template_ids(self, value):
        if not value:
            raise serializers.ValidationError("У заказа должен быть хотя бы один этап.")
        return value

    def create(self, validated_data):
        from .models import ensure_default_stages
        validated_data.pop("sizes_text", None)
        template_ids = validated_data.pop("template_ids", None)
        contract = validated_data.get("contract")
        if contract:
            # из договора подставляется то, что в нём уже есть
            validated_data.setdefault("deadline", contract.deadline)
            if not validated_data.get("client"):
                validated_data["client"] = contract.customer.name[:200]
        order = super().create(validated_data)
        if template_ids is None:
            ensure_default_stages()
            template_ids = list(StageTemplate.objects.filter(is_active=True).values_list("id", flat=True))
        err = set_route(order, template_ids)
        if err:
            raise serializers.ValidationError({"template_ids": err})
        apply_sizes(order, getattr(self, "_size_rows", []))
        return order

    def update(self, instance, validated_data):
        validated_data.pop("sizes_text", None)
        template_ids = validated_data.pop("template_ids", None)
        order = super().update(instance, validated_data)
        if template_ids is not None:
            err = set_route(order, template_ids)
            if err:
                raise serializers.ValidationError({"template_ids": err})
        return order


class WorkOrderDetailSerializer(WorkOrderSerializer):
    """Заказ целиком: этапы, сетка размеров с фактами по каждому этапу,
    исполнители, ткань, история."""
    stages = serializers.SerializerMethodField()
    sizes = serializers.SerializerMethodField()
    workers = serializers.SerializerMethodField()
    materials = serializers.SerializerMethodField()
    history = serializers.SerializerMethodField()
    contract_title = serializers.CharField(source="contract.title", read_only=True, default=None)

    def get_stages(self, obj):
        return [{"id": s.id, "template": s.template_id, "name": s.template.name,
                 "kind": s.template.kind, "extra_label": s.template.extra_label}
                for s in obj.stages.all()]

    def get_sizes(self, obj):
        stages = list(obj.stages.all())
        return [{"id": s.id, "size": s.size, "planned": s.planned, "position": s.position,
                 **size_summary(s, stages)} for s in obj.sizes.all()]

    def get_workers(self, obj):
        """Кто работал по заказу: партии пошива и штуки на остальных этапах."""
        rows = {}
        for s in obj.sizes.all():
            for j in s.jobs.all():
                key = (j.responsible_id, j.workers)
                r = rows.setdefault(key, {"label": who(j) or "не указан", "assigned": 0,
                                          "sewn": 0, "done": 0, "sizes": []})
                r["assigned"] += j.qty
                r["sewn"] += job_sewn(j)
                if s.size not in r["sizes"]:
                    r["sizes"].append(s.size)
            for e in s.entries.all():
                key = (e.responsible_id, e.workers)
                r = rows.setdefault(key, {"label": who(e) or "не указан", "assigned": 0,
                                          "sewn": 0, "done": 0, "sizes": []})
                r["done"] += e.qty
                if s.size not in r["sizes"]:
                    r["sizes"].append(s.size)
        return sorted(rows.values(), key=lambda r: -(r["assigned"] + r["done"]))

    def get_materials(self, obj):
        """Ткань по заказу: метров всего и в среднем на штуку."""
        total = {}
        for s in obj.sizes.all():
            for e in s.entries.all():
                for m in e.materials.all():
                    t = total.setdefault(m.material, {"meters": Decimal("0"), "qty": 0})
                    t["meters"] += m.meters
                    t["qty"] += e.qty
        return [{"material": k, "meters": _num(v["meters"]), "cut_qty": v["qty"],
                 "per_unit": _num(v["meters"] / v["qty"]) if v["qty"] else 0}
                for k, v in sorted(total.items(), key=lambda kv: -kv[1]["meters"])]

    def get_history(self, obj):
        names = {s.id: s.template.name for s in obj.stages.all()}
        events = []
        for s in obj.sizes.all():
            for e in s.entries.all():
                mats = ", ".join(f"{m.material} {_num(m.meters):g} м" for m in e.materials.all())
                extra = " · ".join(x for x in (who(e), e.extra, mats, e.note) if x)
                events.append({"date": e.date, "stamp": e.created_at, "stage": names.get(e.stage_id, ""),
                               "size": s.size, "text": f"{e.qty} шт" + (f" · {extra}" if extra else "")})
            for j in s.jobs.all():
                label = who(j) or "без исполнителя"
                events.append({"date": j.started, "stamp": j.created_at, "stage": names.get(j.stage_id, ""),
                               "size": s.size, "text": f"выдано в пошив · {label}: {j.qty} шт"})
                for p in j.progress.all():
                    mark = "на упаковке" if p.ready >= 1 else f"готовность {int(p.ready * 100)}%"
                    events.append({"date": p.date, "stamp": None, "stage": names.get(j.stage_id, ""),
                                   "size": s.size, "text": f"{label}: {mark}"})
        events.sort(key=lambda e: (e["date"], str(e["stamp"] or "")), reverse=True)
        for e in events:
            e.pop("stamp")
        return events[:300]


def _capacity_error(size, stage, qty, verb):
    free, prev, prev_done, here = free_capacity(size, stage)
    if free is not None and qty > free:
        return (f"Размер {size.size}: этап «{prev.template.name}» прошли {prev_done} шт, "
                f"на «{stage.template.name}» уже {here}, {verb} можно ещё {max(free, 0)}.")
    return None


class EntryMaterialSerializer(serializers.ModelSerializer):
    per_unit = serializers.SerializerMethodField()

    class Meta:
        model = EntryMaterial
        fields = ["id", "material", "meters", "per_unit"]

    def get_per_unit(self, obj):
        return _num(obj.per_unit)


class StageEntrySerializer(serializers.ModelSerializer):
    materials = EntryMaterialSerializer(many=True, required=False)
    size_label = serializers.CharField(source="size.size", read_only=True)
    stage_name = serializers.CharField(source="stage.template.name", read_only=True)
    who_label = serializers.SerializerMethodField()
    order = serializers.IntegerField(source="stage.order_id", read_only=True)

    class Meta:
        model = StageEntry
        fields = "__all__"

    def get_who_label(self, obj):
        return who(obj) or None

    def validate_materials(self, value):
        clean, seen = [], set()
        for m in value:
            name = (m.get("material") or "").strip()
            if not name:
                continue
            if name.lower() in seen:
                raise serializers.ValidationError(f"Материал «{name}» указан дважды.")
            seen.add(name.lower())
            clean.append({"material": name, "meters": m["meters"]})
        return clean

    def validate(self, attrs):
        stage, size = attrs["stage"], attrs["size"]
        if stage.order_id != size.order_id:
            raise serializers.ValidationError({"size": "Размер из другого заказа."})
        kind = stage.template.kind
        if kind == StageTemplate.Kind.SEWING:
            raise serializers.ValidationError(
                {"stage": "На этап пошива выдают партии бригадам, а не пишут штуки."})
        if attrs.get("materials") and kind != StageTemplate.Kind.CUT:
            raise serializers.ValidationError({"materials": "Метраж пишется только в крое."})
        err = _capacity_error(size, stage, attrs["qty"], "записать")
        if err:
            raise serializers.ValidationError({"qty": err})
        return attrs

    def create(self, validated_data):
        materials = validated_data.pop("materials", [])
        entry = StageEntry.objects.create(**validated_data)
        EntryMaterial.objects.bulk_create(EntryMaterial(entry=entry, **m) for m in materials)
        return entry


class SewingProgressSerializer(serializers.ModelSerializer):
    class Meta:
        model = SewingProgress
        fields = "__all__"


class SewingJobSerializer(serializers.ModelSerializer):
    who_label = serializers.SerializerMethodField()
    size_label = serializers.CharField(source="size.size", read_only=True)
    ready = serializers.SerializerMethodField()
    sewn = serializers.SerializerMethodField()
    progress = SewingProgressSerializer(many=True, read_only=True)

    class Meta:
        model = SewingJob
        fields = "__all__"

    def get_who_label(self, obj):
        return who(obj) or "не указан"

    def get_ready(self, obj):
        return _num(job_ready(obj))

    def get_sewn(self, obj):
        return job_sewn(obj)

    def validate(self, attrs):
        stage, size = attrs["stage"], attrs["size"]
        if stage.order_id != size.order_id:
            raise serializers.ValidationError({"size": "Размер из другого заказа."})
        if stage.template.kind != StageTemplate.Kind.SEWING:
            raise serializers.ValidationError({"stage": "Бригадам выдают только на этапе пошива."})
        err = _capacity_error(size, stage, attrs["qty"], "выдать")
        if err:
            raise serializers.ValidationError({"qty": err})
        return attrs
