"""Сводки цеха: сколько каждый размер прошёл по каждому этапу заказа.

Считается в Python по заранее подтянутым связям (with_details), а не
отдельными запросами на каждый размер: заказов в цехе десятки, размеров
в заказе до двух десятков, и так страница собирается за несколько запросов.

Правило этапов: через этап нельзя провести больше, чем прошло предыдущий
этап заказа. Упаковать можно не больше, чем почищено, почистить — не
больше, чем сшито. У пошива «прошло» — это сшитое: выдано × готовность.
Первый этап (обычно крой) не ограничен: кроят и сверх плана.
"""
import re
from decimal import Decimal, ROUND_HALF_UP

SEWING = "sewing"


def with_details(qs):
    return qs.select_related("contract").prefetch_related(
        "stages__template",
        "sizes__entries__materials",
        "sizes__jobs__progress", "sizes__jobs__brigade")


def job_ready(job):
    progress = list(job.progress.all())          # упорядочено по дате: последняя — текущая
    return progress[-1].ready if progress else Decimal("0")


def job_sewn(job):
    """Сшито штук = выдано × готовность, с округлением до целой штуки."""
    return int((Decimal(job.qty) * job_ready(job)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def size_stage_stats(size, stages):
    """{id этапа заказа: {done, assigned, in_work}} для одного размера.

    done — прошло этап; assigned — взято в работу (у пошива выдано бригадам,
    у остальных этапов совпадает с done); in_work — выдано, но ещё не сшито.
    """
    entries = list(size.entries.all())
    jobs = list(size.jobs.all())
    out = {}
    for st in stages:
        if st.template.kind == SEWING:
            js = [j for j in jobs if j.stage_id == st.id]
            assigned = sum(j.qty for j in js)
            sewn = sum(job_sewn(j) for j in js)
            out[st.id] = {"done": sewn, "assigned": assigned, "in_work": assigned - sewn}
        else:
            done = sum(e.qty for e in entries if e.stage_id == st.id)
            out[st.id] = {"done": done, "assigned": done, "in_work": 0}
    return out


def size_summary(size, stages):
    per = size_stage_stats(size, stages)
    finished = per[stages[-1].id]["done"] if stages else 0
    return {"planned": size.planned, "stages": per, "finished": finished,
            "left": max(size.planned - finished, 0)}


def order_summary(order):
    """Итог заказа: план, сколько прошло последний этап, и по каждому этапу."""
    stages = list(order.stages.all())
    totals = {st.id: {"done": 0, "assigned": 0, "in_work": 0} for st in stages}
    planned = finished = left = 0
    for s in order.sizes.all():
        sm = size_summary(s, stages)
        planned += sm["planned"]
        finished += sm["finished"]
        left += sm["left"]
        for sid, v in sm["stages"].items():
            for k in v:
                totals[sid][k] += v[k]
    return {
        "planned": planned, "finished": finished, "left": left,
        "stages": [{"id": st.id, "template": st.template_id, "name": st.template.name,
                    "kind": st.template.kind, **totals[st.id]} for st in stages],
    }


def free_capacity(size, stage, exclude_entry=None):
    """Сколько штук размера ещё можно провести через этап заказа.

    Возвращает (свободно, предыдущий этап, прошло предыдущий, уже на этом).
    Для первого этапа свободно = None: он не ограничен.
    """
    stages = list(stage.order.stages.select_related("template"))
    ids = [s.id for s in stages]
    idx = ids.index(stage.id)
    per = size_stage_stats(size, stages)
    here = per[stage.id]["assigned"]
    if idx == 0:
        return None, None, None, here
    prev = stages[idx - 1]
    prev_done = per[prev.id]["done"]
    return prev_done - here, prev, prev_done, here


# Размеры вставляют столбиком, как пишут в отчёте цеха: «54/176 - 27 шт».
# Количество — последнее число строки после пробела; всё до него — размер.
# Сам размер может содержать и дефисы, и цифры: «56-58/170-176 116шт».
SIZE_LINE = re.compile(r"^(.*\S)\s+[-–—:]?\s*(\d+)\s*(?:шт\.?|ш|комп\.?|компл\.?|пар)?\s*$",
                       re.IGNORECASE)


def parse_sizes(text):
    rows, errors, seen = [], [], set()
    for n, raw in enumerate((text or "").splitlines(), start=1):
        line = raw.strip()
        if not line:
            continue
        m = SIZE_LINE.match(line)
        if not m:
            errors.append(f"строка {n}: «{line}» — не вижу количества. "
                          "Пишите размер и через пробел число: «54/176 - 27».")
            continue
        size = m.group(1).strip().rstrip("-–—:").strip()
        qty = int(m.group(2))
        if not size:
            errors.append(f"строка {n}: «{line}» — не вижу размера.")
        elif qty < 1:
            errors.append(f"строка {n}: «{line}» — количество должно быть больше нуля.")
        elif size in seen:
            errors.append(f"строка {n}: размер {size} уже есть выше.")
        else:
            seen.add(size)
            rows.append((size, qty))
    return rows, errors


def apply_sizes(order, rows):
    """Добавить размеры в заказ. Если размер уже есть — обновить его план."""
    from .models import WorkSize
    existing = {s.size: s for s in order.sizes.all()}
    position = max((s.position for s in existing.values()), default=-1) + 1
    added = updated = 0
    for size, qty in rows:
        if size in existing:
            obj = existing[size]
            if obj.planned != qty:
                obj.planned = qty
                obj.save(update_fields=["planned"])
            updated += 1
        else:
            WorkSize.objects.create(order=order, size=size, planned=qty, position=position)
            position += 1
            added += 1
    return added, updated


def set_route(order, template_ids):
    """Задать этапы заказа. Этап, по которому уже есть записи, убрать нельзя.
    Возвращает текст ошибки или None."""
    from .models import StageTemplate, WorkOrderStage
    wanted = set(int(t) for t in template_ids)
    if not wanted:
        return "У заказа должен быть хотя бы один этап."
    known = set(StageTemplate.objects.filter(id__in=wanted).values_list("id", flat=True))
    if known != wanted:
        return "Среди выбранных есть несуществующий этап."
    current = {s.template_id: s for s in order.stages.select_related("template")}
    for tid, st in current.items():
        if tid not in wanted and (st.entries.exists() or st.jobs.exists()):
            return (f"Этап «{st.template.name}» убрать нельзя: по нему уже есть записи. "
                    "Сначала удалите их на листе этапа.")
    for tid, st in current.items():
        if tid not in wanted:
            st.delete()
    for tid in wanted - set(current):
        WorkOrderStage.objects.create(order=order, template_id=tid)
    return None
