from decimal import Decimal
from rest_framework import serializers
from .models import (Brigade, WorkOrder, WorkSize, CutEntry, CutMaterial, EmbroideryEntry,
                     SewingJob, SewingProgress, PackEntry)
from .calc import job_ready, job_sewn, size_stats, order_stats, parse_sizes, apply_sizes


def _num(v):
    return float(round(Decimal(v), 2))


class BrigadeSerializer(serializers.ModelSerializer):
    label = serializers.SerializerMethodField()
    stats = serializers.SerializerMethodField()

    class Meta:
        model = Brigade
        fields = "__all__"

    def get_label(self, obj):
        return str(obj)

    def get_stats(self, obj):
        """Сколько бригада сшила и сколько ей начислено по расценкам заказов."""
        sewn = in_work = active = 0
        earned = Decimal("0")
        for job in obj.jobs.all():
            s = job_sewn(job)
            sewn += s
            earned += s * job.size.order.sewing_rate
            if job.qty > s:
                in_work += job.qty - s
                active += 1
        return {"sewn": sewn, "in_work": in_work, "active_jobs": active, "earned": _num(earned)}


class WorkSizeSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkSize
        fields = "__all__"


class WorkOrderSerializer(serializers.ModelSerializer):
    contract_number = serializers.CharField(source="contract.number", read_only=True, default=None)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    totals = serializers.SerializerMethodField()
    sizes_count = serializers.SerializerMethodField()
    # Сетка размеров столбиком при заведении заказа: «54/176 - 27 шт»
    sizes_text = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = WorkOrder
        fields = "__all__"

    def get_totals(self, obj):
        return order_stats(obj)

    def get_sizes_count(self, obj):
        return len(obj.sizes.all())

    def validate_sizes_text(self, value):
        rows, errors = parse_sizes(value)
        if errors:
            raise serializers.ValidationError(errors)
        self._size_rows = rows
        return value

    def create(self, validated_data):
        validated_data.pop("sizes_text", None)
        order = super().create(validated_data)
        apply_sizes(order, getattr(self, "_size_rows", []))
        return order

    def update(self, instance, validated_data):
        validated_data.pop("sizes_text", None)
        return super().update(instance, validated_data)


class WorkOrderDetailSerializer(WorkOrderSerializer):
    """Заказ целиком: сетка размеров с фактами по каждому, бригады, ткань, история."""
    sizes = serializers.SerializerMethodField()
    brigades = serializers.SerializerMethodField()
    materials = serializers.SerializerMethodField()
    history = serializers.SerializerMethodField()

    def get_sizes(self, obj):
        out = []
        for s in obj.sizes.all():
            size_materials = {}
            cuts = []
            for c in s.cuts.all():
                mats = []
                for m in c.materials.all():
                    mats.append({"material": m.material, "meters": _num(m.meters),
                                 "per_unit": _num(m.per_unit)})
                    size_materials[m.material] = size_materials.get(m.material, Decimal("0")) + m.meters
                cuts.append({"id": c.id, "date": c.date, "qty": c.qty, "note": c.note,
                             "materials": mats})
            jobs = [{"id": j.id, "brigade": j.brigade_id, "brigade_label": str(j.brigade),
                     "qty": j.qty, "started": j.started, "ready": _num(job_ready(j)),
                     "sewn": job_sewn(j),
                     "progress": [{"id": p.id, "date": p.date, "ready": _num(p.ready)}
                                  for p in j.progress.all()]}
                    for j in s.sewing.all()]
            stats = size_stats(s)
            out.append({
                "id": s.id, "size": s.size, "planned": s.planned, "position": s.position,
                "stats": stats,
                "cuts": cuts,
                "embroidery": [{"id": e.id, "date": e.date, "qty": e.qty, "kind": e.kind,
                                "note": e.note} for e in s.embroidery.all()],
                "jobs": jobs,
                "packs": [{"id": p.id, "date": p.date, "qty": p.qty, "note": p.note}
                          for p in s.packs.all()],
                "materials": [{"material": k, "meters": _num(v),
                               "per_unit": _num(v / stats["cut"]) if stats["cut"] else 0}
                              for k, v in size_materials.items()],
            })
        return out

    def get_brigades(self, obj):
        rows = {}
        for s in obj.sizes.all():
            for j in s.sewing.all():
                r = rows.setdefault(j.brigade_id, {"brigade": j.brigade_id,
                                                   "label": str(j.brigade),
                                                   "assigned": 0, "sewn": 0, "sizes": []})
                r["assigned"] += j.qty
                r["sewn"] += job_sewn(j)
                if s.size not in r["sizes"]:
                    r["sizes"].append(s.size)
        for r in rows.values():
            r["earned"] = _num(r["sewn"] * obj.sewing_rate)
        return sorted(rows.values(), key=lambda r: -r["assigned"])

    def get_materials(self, obj):
        """Ткань по заказу: метров всего и в среднем на штуку."""
        total = {}
        for s in obj.sizes.all():
            for c in s.cuts.all():
                for m in c.materials.all():
                    t = total.setdefault(m.material, {"meters": Decimal("0"), "qty": 0})
                    t["meters"] += m.meters
                    t["qty"] += c.qty
        return [{"material": k, "meters": _num(v["meters"]), "cut_qty": v["qty"],
                 "per_unit": _num(v["meters"] / v["qty"]) if v["qty"] else 0}
                for k, v in sorted(total.items(), key=lambda kv: -kv[1]["meters"])]

    def get_history(self, obj):
        events = []
        for s in obj.sizes.all():
            for c in s.cuts.all():
                mats = ", ".join(f"{m.material} {_num(m.meters):g} м" for m in c.materials.all())
                events.append({"date": c.date, "stamp": c.created_at, "kind": "cut",
                               "size": s.size, "qty": c.qty,
                               "text": f"скроено {c.qty} шт" + (f" · {mats}" if mats else "")})
            for e in s.embroidery.all():
                events.append({"date": e.date, "stamp": e.created_at, "kind": "embroidery",
                               "size": s.size, "qty": e.qty,
                               "text": f"вышито {e.qty} шт" + (f" · {e.kind}" if e.kind else "")})
            for j in s.sewing.all():
                events.append({"date": j.started, "stamp": j.created_at, "kind": "sewing",
                               "size": s.size, "qty": j.qty,
                               "text": f"выдано бригаде {j.brigade}: {j.qty} шт"})
                for p in j.progress.all():
                    label = "на упаковке" if p.ready >= 1 else f"готовность {int(p.ready * 100)}%"
                    events.append({"date": p.date, "stamp": None, "kind": "progress",
                                   "size": s.size, "qty": None,
                                   "text": f"{j.brigade}: {label}"})
            for p in s.packs.all():
                events.append({"date": p.date, "stamp": p.created_at, "kind": "pack",
                               "size": s.size, "qty": p.qty, "text": f"упаковано {p.qty} шт"})
        events.sort(key=lambda e: (e["date"], str(e["stamp"] or "")), reverse=True)
        for e in events:
            e.pop("stamp")
        return events[:300]


class CutMaterialSerializer(serializers.ModelSerializer):
    per_unit = serializers.SerializerMethodField()

    class Meta:
        model = CutMaterial
        fields = ["id", "material", "meters", "per_unit"]

    def get_per_unit(self, obj):
        return _num(obj.per_unit)


class CutEntrySerializer(serializers.ModelSerializer):
    materials = CutMaterialSerializer(many=True, required=False)

    class Meta:
        model = CutEntry
        fields = "__all__"

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

    def create(self, validated_data):
        materials = validated_data.pop("materials", [])
        entry = CutEntry.objects.create(**validated_data)
        CutMaterial.objects.bulk_create(CutMaterial(cut=entry, **m) for m in materials)
        return entry


class EmbroideryEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = EmbroideryEntry
        fields = "__all__"


class SewingProgressSerializer(serializers.ModelSerializer):
    class Meta:
        model = SewingProgress
        fields = "__all__"


class SewingJobSerializer(serializers.ModelSerializer):
    brigade_label = serializers.SerializerMethodField()
    ready = serializers.SerializerMethodField()
    sewn = serializers.SerializerMethodField()

    class Meta:
        model = SewingJob
        fields = "__all__"

    def get_brigade_label(self, obj):
        return str(obj.brigade)

    def get_ready(self, obj):
        return _num(job_ready(obj))

    def get_sewn(self, obj):
        return job_sewn(obj)


class PackEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = PackEntry
        fields = "__all__"

    def validate(self, attrs):
        """Упаковать можно не больше, чем сшито.

        Упаковка — итоговый счёт, который уходит на склад и в отгрузку, поэтому
        здесь проверка жёсткая. Сшитое считается по готовности бригад: чтобы
        упаковать всю партию, её отмечают «на упаковке».
        """
        size = attrs["size"]
        stats = size_stats(size)
        free = stats["sewn"] - stats["packed"]
        if attrs["qty"] > free:
            raise serializers.ValidationError({"qty": (
                f"Размер {size.size}: сшито {stats['sewn']} шт, упаковано уже {stats['packed']}, "
                f"упаковать можно ещё {max(free, 0)}. Если бригада закончила, отметьте ей "
                "«на упаковке».")})
        return attrs
