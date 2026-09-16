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
        "sizes__jobs__progress", "sizes__jobs__responsible",
        "sizes__entries__responsible")


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
# Количество — последнее число строки; всё до него — размер. Размер
# приводится к одному написанию по размерной сетке (см. sizes.py).
SIZE_LINE = re.compile(r"^(?P<size>.*?\S)\s+(?P<sep>[-–—:]\s*)?(?P<qty>\d+)\s*"
                       r"(?P<unit>шт\.?|ш|комп\.?|компл\.?|пар)?\s*$", re.IGNORECASE)


def parse_sizes(text):
    """[(размер, план)] и ошибки по строкам. Размеры — уже одним написанием."""
    from .sizes import normalize_size, is_height, LETTERS, ONE_SIZE
    rows, errors, seen = [], [], {}
    for n, raw in enumerate((text or "").splitlines(), start=1):
        line = raw.strip()
        if not line:
            continue
        m = SIZE_LINE.match(line)
        if not m:
            errors.append(f"строка {n}: «{line}» — не вижу количества. "
                          "Пишите размер и через пробел количество: «54/176 - 27».")
            continue
        size, err = normalize_size(m.group("size").strip().rstrip("-–—:").strip())
        qty = int(m.group("qty"))
        if err:
            errors.append(f"строка {n}: {err}" + ("" if err[-1] in ".?!" else "."))
            continue
        # «54 176» без тире и «шт»: это размер 54/176 без количества или 176 штук 54-го?
        if (not m.group("sep") and not m.group("unit") and "/" not in size
                and size not in LETTERS and size != ONE_SIZE and is_height(qty)):
            errors.append(f"строка {n}: «{line}» — это размер {size}/{qty} без количества "
                          f"или {qty} шт размера {size}? Напишите «{size}/{qty} - 27» или «{size} - {qty} шт».")
            continue
        if qty < 1:
            errors.append(f"строка {n}: «{line}» — количество должно быть больше нуля.")
        elif size in seen:
            errors.append(f"строка {n}: размер {size} уже есть в строке {seen[size]}.")
        else:
            seen[size] = n
            rows.append((size, qty))
    return rows, errors


def resort_sizes(order):
    """Строки сетки по порядку: размер, внутри — рост."""
    from .models import WorkSize
    from .sizes import size_sort_key
    sizes = sorted(WorkSize.objects.filter(order=order), key=lambda s: size_sort_key(s.size))
    for pos, s in enumerate(sizes):
        if s.position != pos:
            s.position = pos
            s.save(update_fields=["position"])


def apply_sizes(order, rows):
    """Добавить размеры в заказ. Если размер уже есть — обновить его план.
    Размер, записанный раньше по-другому («54-188»), узнаётся как тот же."""
    from .models import WorkSize
    from .sizes import normalize_size
    existing = {}
    for s in WorkSize.objects.filter(order=order):
        canon, err = normalize_size(s.size)
        existing.setdefault(s.size if err else canon, s)
    added = updated = 0
    for size, qty in rows:
        obj = existing.get(size)
        if obj:
            fields = []
            if obj.planned != qty:
                obj.planned = qty
                fields.append("planned")
            if obj.size != size and not WorkSize.objects.filter(order=order, size=size).exists():
                obj.size = size
                fields.append("size")
            if fields:
                obj.save(update_fields=fields)
            updated += 1
        else:
            existing[size] = WorkSize.objects.create(order=order, size=size, planned=qty, position=0)
            added += 1
    resort_sizes(order)
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
