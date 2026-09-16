from collections import OrderedDict
from datetime import date as date_cls
from django.db import transaction
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from accounts.permissions import RoleSectionPermission, can_read
from accounts.mixins import SafeDestroyMixin
from .calc import (with_details, parse_sizes, apply_sizes, set_route, order_summary,
                   size_stage_stats, job_ready, job_sewn)
from .models import (StageTemplate, WorkOrder, WorkOrderStage, WorkSize, StageEntry,
                     SewingJob, SewingProgress, ensure_default_stages)
from .serializers import (StageTemplateSerializer, WorkOrderSerializer, WorkOrderDetailSerializer,
                          WorkSizeSerializer, StageEntrySerializer, SewingJobSerializer,
                          SewingProgressSerializer, who, _num)

# Записи цеха — факты: их не правят, а удаляют ошибочную и вносят заново.
# Так в истории не бывает тихо переписанных цифр.
FACTS_ONLY = ["get", "post", "delete", "head", "options"]


class Base(SafeDestroyMixin, viewsets.ModelViewSet):
    permission_classes = [RoleSectionPermission]
    section = "workshop"


def _parse_date(value):
    try:
        return date_cls.fromisoformat(value) if value else None
    except ValueError:
        return None


class StageTemplateViewSet(Base):
    access_key = "workshop.stages"
    queryset = StageTemplate.objects.all()
    serializer_class = StageTemplateSerializer

    def list(self, request, *args, **kwargs):
        ensure_default_stages()
        return super().list(request, *args, **kwargs)

    @action(detail=False, methods=["post"])
    def reorder(self, request):
        """Новый порядок этапов: {"ids": [3, 1, 2]}. Порядок общий для всех заказов."""
        ids = [int(i) for i in request.data.get("ids", [])]
        templates = {t.id: t for t in StageTemplate.objects.all()}
        if sorted(ids) != sorted(templates):
            return Response({"detail": "Нужно передать все этапы, каждый по одному разу."}, status=400)
        # Порядок общий для всех заказов. Если в каком-то заказе уже есть записи
        # по двум этапам, переставить их местами нельзя: упакованное оказалось бы
        # раньше сшитого, и итоги заказа перестали бы сходиться.
        old_rank = {tid: i for i, tid in enumerate(templates)}
        new_rank = {tid: i for i, tid in enumerate(ids)}
        used = {}
        for model in (StageEntry, SewingJob):
            for order_id, tid in model.objects.values_list("stage__order_id", "stage__template_id").distinct():
                used.setdefault(order_id, set()).add(tid)
        for order_id, tids in used.items():
            tids = sorted(tids)
            for i, a in enumerate(tids):
                for b in tids[i + 1:]:
                    if (old_rank[a] < old_rank[b]) != (new_rank[a] < new_rank[b]):
                        order = WorkOrder.objects.get(pk=order_id)
                        return Response({"detail": (
                            f"Нельзя поменять местами «{templates[a].name}» и «{templates[b].name}»: "
                            f"в заказе «{order.product}» по обоим этапам уже есть записи.")}, status=400)
        with transaction.atomic():
            for pos, tid in enumerate(ids):
                StageTemplate.objects.filter(pk=tid).update(position=pos)
        return Response(StageTemplateSerializer(StageTemplate.objects.all(), many=True).data)

    @action(detail=False, methods=["get"])
    def overview(self, request):
        """Карточки этапов на главной цеха: по заказам в работе — сколько прошло
        этап, сколько ждёт его (прошло предыдущий, а сюда ещё не взято), сколько в пошиве."""
        ensure_default_stages()
        stats = OrderedDict((t.id, {"id": t.id, "name": t.name, "kind": t.kind, "is_active": t.is_active,
                                    "orders": 0, "done": 0, "waiting": 0, "in_work": 0})
                            for t in StageTemplate.objects.all())
        for order in with_details(WorkOrder.objects.filter(status=WorkOrder.Status.IN_WORK)):
            stages = list(order.stages.all())
            for st in stages:
                stats[st.template_id]["orders"] += 1
            for size in order.sizes.all():
                per = size_stage_stats(size, stages)
                for i, st in enumerate(stages):
                    row = stats[st.template_id]
                    row["done"] += per[st.id]["done"]
                    row["in_work"] += per[st.id]["in_work"]
                    ready_for = per[stages[i - 1].id]["done"] if i else size.planned
                    row["waiting"] += max(ready_for - per[st.id]["assigned"], 0)
        return Response([s for s in stats.values() if s["is_active"] or s["orders"]])

    @action(detail=True, methods=["get"])
    def sheet(self, request, pk=None):
        """Лист этапа — как лист отчёта цеха.

        Для кроя и штучных этапов — записи по дням; для пошива — партии бригад
        и готовность по датам колонками. Сверху — заказы, которые проходят этап,
        с тем, сколько по каждому размеру можно взять в работу.
        Параметры: status (in_work по умолчанию, all), order, date_from, date_to.
        """
        if not can_read(request.user, "workshop.entries"):
            return Response({"detail": "Нет доступа к записям этапов."}, status=403)
        template = self.get_object()
        st_filter = request.query_params.get("status", "in_work")
        order_id = request.query_params.get("order")
        d_from = _parse_date(request.query_params.get("date_from"))
        d_to = _parse_date(request.query_params.get("date_to"))

        orders_qs = WorkOrder.objects.filter(stages__template=template)
        if st_filter != "all":
            orders_qs = orders_qs.filter(status=st_filter)
        if order_id:
            orders_qs = orders_qs.filter(pk=order_id)
        orders_qs = with_details(orders_qs.select_related("contract__customer").distinct())

        orders, stage_ids = [], []
        for o in orders_qs:
            stages = list(o.stages.all())
            me = next(s for s in stages if s.template_id == template.id)
            idx = stages.index(me)
            prev = stages[idx - 1] if idx else None
            stage_ids.append(me.id)
            sizes, tot = [], {"planned": 0, "done": 0, "assigned": 0, "in_work": 0, "free": 0}
            for s in o.sizes.all():
                per = size_stage_stats(s, stages)
                here = per[me.id]
                prev_done = per[prev.id]["done"] if prev else None
                free = max((prev_done if prev else s.planned) - here["assigned"], 0)
                sizes.append({"id": s.id, "size": s.size, "planned": s.planned,
                              "prev_done": prev_done, **here, "free": free})
                tot["planned"] += s.planned
                for k in ("done", "assigned", "in_work"):
                    tot[k] += here[k]
                tot["free"] += free
            c = o.contract
            orders.append({"order": o.id, "stage": me.id, "product": o.product,
                           "status": o.status, "deadline": o.deadline,
                           "contract": c.id if c else None,
                           "contract_number": (c.purchase_no or c.number) if c else None,
                           "customer": c.customer.name if c else o.client,
                           "prev_stage": prev.template.name if prev else None,
                           "sizes": sizes, "totals": tot})

        data = {"template": StageTemplateSerializer(template).data, "orders": orders}
        if template.kind == StageTemplate.Kind.SEWING:
            jobs = (SewingJob.objects.filter(stage_id__in=stage_ids)
                    .select_related("responsible", "size", "stage__order")
                    .prefetch_related("progress"))
            dates, rows = set(), []
            for j in jobs:
                progress = list(j.progress.all())
                cells = {}
                for p in progress:
                    if (d_from and p.date < d_from) or (d_to and p.date > d_to):
                        continue
                    cells[p.date.isoformat()] = _num(p.ready)
                    dates.add(p.date.isoformat())
                rows.append({"id": j.id, "responsible": j.responsible_id, "workers": j.workers,
                             "who_label": who(j) or "не указан",
                             "order": j.stage.order_id, "product": j.stage.order.product,
                             "size_id": j.size_id, "size": j.size.size, "qty": j.qty,
                             "started": j.started, "cells": cells,
                             "ready": _num(job_ready(j)), "sewn": job_sewn(j)})
            rows.sort(key=lambda r: (r["who_label"], r["order"], str(r["started"])))
            data.update({"dates": sorted(dates), "jobs": rows})
        else:
            entries = (StageEntry.objects.filter(stage_id__in=stage_ids)
                       .select_related("size", "stage__order", "responsible").prefetch_related("materials"))
            if d_from:
                entries = entries.filter(date__gte=d_from)
            if d_to:
                entries = entries.filter(date__lte=d_to)
            rows = []
            for e in entries[:2000]:
                rows.append({"id": e.id, "date": e.date, "order": e.stage.order_id,
                             "product": e.stage.order.product, "size_id": e.size_id, "size": e.size.size,
                             "qty": e.qty, "extra": e.extra, "note": e.note,
                             "responsible": e.responsible_id, "workers": e.workers,
                             "who_label": who(e) or None,
                             "materials": [{"material": m.material, "meters": _num(m.meters),
                                            "per_unit": _num(m.per_unit)} for m in e.materials.all()]})
            data["entries"] = rows
        return Response(data)


class WorkOrderViewSet(Base):
    access_key = "workshop.orders"
    queryset = with_details(WorkOrder.objects.select_related("contract__customer"))
    filterset_fields = ["status", "contract"]
    search_fields = ["product", "client", "contract__number", "contract__purchase_no"]

    def get_serializer_class(self):
        if self.action in ("retrieve", "sizes_bulk", "set_status", "set_route"):
            return WorkOrderDetailSerializer
        return WorkOrderSerializer

    def _detail(self, order):
        order = self.get_queryset().get(pk=order.pk)
        return WorkOrderDetailSerializer(order, context=self.get_serializer_context()).data

    @action(detail=True, methods=["post"])
    def sizes_bulk(self, request, pk=None):
        """Добавить размеры столбиком. Всё или ничего."""
        order = self.get_object()
        rows, errors = parse_sizes(request.data.get("text", ""))
        if errors:
            return Response({"detail": "\n".join(errors)}, status=status.HTTP_400_BAD_REQUEST)
        if not rows:
            return Response({"detail": "Не указано ни одного размера."},
                            status=status.HTTP_400_BAD_REQUEST)
        added, updated = apply_sizes(order, rows)
        data = self._detail(order)
        data["report"] = {"added": added, "updated": updated}
        return Response(data)

    @action(detail=True, methods=["post"])
    def set_status(self, request, pk=None):
        order = self.get_object()
        new = request.data.get("status")
        if new not in dict(WorkOrder.Status.choices):
            return Response({"detail": "Неизвестный статус."}, status=status.HTTP_400_BAD_REQUEST)
        order.status = new
        order.save(update_fields=["status"])
        return Response(self._detail(order))

    @action(detail=True, methods=["post"])
    def set_route(self, request, pk=None):
        """Этапы заказа: {"template_ids": [...]}. По которому уже работали — не убрать."""
        order = self.get_object()
        with transaction.atomic():
            err = set_route(order, request.data.get("template_ids") or [])
            if err:
                return Response({"detail": err}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self._detail(order))


class WorkSizeViewSet(Base):
    access_key = "workshop.orders"
    queryset = WorkSize.objects.select_related("order")
    serializer_class = WorkSizeSerializer
    filterset_fields = ["order"]


def _removal_error(size, stage, removed_done):
    """Нельзя убрать запись, если следующий этап уже взял в работу больше,
    чем останется на этом: упакованное не может оказаться непочищенным."""
    stages = list(stage.order.stages.select_related("template"))
    idx = [s.id for s in stages].index(stage.id)
    if idx == len(stages) - 1:
        return None
    nxt = stages[idx + 1]
    per = size_stage_stats(size, stages)
    after = per[stage.id]["done"] - removed_done
    if per[nxt.id]["assigned"] > after:
        return (f"Размер {size.size}: на этапе «{nxt.template.name}» уже {per[nxt.id]['assigned']} шт, "
                f"а без этой записи на «{stage.template.name}» останется {after}. "
                f"Сначала удалите записи этапа «{nxt.template.name}».")
    return None


class StageEntryViewSet(Base):
    access_key = "workshop.entries"
    http_method_names = FACTS_ONLY
    queryset = (StageEntry.objects.select_related("size", "stage__template", "stage__order",
                                                  "responsible").prefetch_related("materials"))
    serializer_class = StageEntrySerializer
    filterset_fields = ["stage", "size", "stage__order", "stage__template"]

    @action(detail=False, methods=["get"])
    def workers(self, request):
        """Кто сколько сделал: строка на ответственного с людьми, которых он вписал.
        Штуки — по этапам, пошив — сшитое из партий."""
        rows = {}

        def row(obj):
            key = (obj.responsible_id, obj.workers)
            return rows.setdefault(key, {
                "responsible": obj.responsible_id, "label": who(obj) or "не указан",
                "workers": obj.workers, "by_stage": {}, "sewn": 0, "in_work": 0})

        for e in (StageEntry.objects.select_related("responsible", "stage__template")
                  .filter(stage__order__status=WorkOrder.Status.IN_WORK)):
            r = row(e)
            name = e.stage.template.name
            r["by_stage"][name] = r["by_stage"].get(name, 0) + e.qty
        for j in (SewingJob.objects.select_related("responsible", "stage__template")
                  .prefetch_related("progress")
                  .filter(stage__order__status=WorkOrder.Status.IN_WORK)):
            r = row(j)
            sewn = job_sewn(j)
            r["sewn"] += sewn
            r["in_work"] += max(j.qty - sewn, 0)
            name = j.stage.template.name
            r["by_stage"][name] = r["by_stage"].get(name, 0) + sewn

        out = []
        for r in rows.values():
            r["by_stage"] = [{"name": k, "qty": v} for k, v in sorted(r["by_stage"].items(),
                                                                      key=lambda kv: -kv[1])]
            r["total"] = sum(s["qty"] for s in r["by_stage"])
            out.append(r)
        return Response(sorted(out, key=lambda r: -r["total"]))

    def destroy(self, request, *args, **kwargs):
        entry = self.get_object()
        err = _removal_error(entry.size, entry.stage, entry.qty)
        if err:
            return Response({"detail": err}, status=status.HTTP_400_BAD_REQUEST)
        return super().destroy(request, *args, **kwargs)


class SewingJobViewSet(Base):
    access_key = "workshop.entries"
    http_method_names = FACTS_ONLY
    queryset = (SewingJob.objects.select_related("responsible", "size", "stage__template", "stage__order")
                .prefetch_related("progress"))
    serializer_class = SewingJobSerializer
    filterset_fields = ["stage", "size", "stage__order", "responsible"]

    def destroy(self, request, *args, **kwargs):
        job = self.get_object()
        err = _removal_error(job.size, job.stage, job_sewn(job))
        if err:
            return Response({"detail": err}, status=status.HTTP_400_BAD_REQUEST)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def progress(self, request, pk=None):
        """Готовность партии на дату: доля от 0 до 1, 1 — «на упаковке».
        На одну дату одна отметка: повторная её заменяет."""
        job = self.get_object()
        s = SewingProgressSerializer(data={**request.data, "job": job.pk})
        s.is_valid(raise_exception=True)
        with transaction.atomic():
            SewingProgress.objects.filter(job=job, date=s.validated_data["date"]).delete()
            s.save()
        job = self.get_queryset().get(pk=job.pk)
        return Response(SewingJobSerializer(job).data)


class SewingProgressViewSet(Base):
    access_key = "workshop.entries"
    http_method_names = ["get", "delete", "head", "options"]
    queryset = SewingProgress.objects.select_related("job")
    serializer_class = SewingProgressSerializer
    filterset_fields = ["job"]
