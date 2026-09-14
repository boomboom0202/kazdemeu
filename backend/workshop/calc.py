"""Сводки цеха: из фактов по размеру — сколько скроено, сшито, упаковано.

Считается в Python по заранее подтянутым связям (with_details), а не
отдельными запросами на каждый размер: заказов в цехе десятки, размеров
в заказе до двух десятков, и так страница собирается за несколько запросов.
"""
import re
from decimal import Decimal, ROUND_HALF_UP

STAGES = ["planned", "cut", "embroidered", "assigned", "in_sewing", "sewn", "packed", "left"]


def with_details(qs):
    return qs.prefetch_related(
        "sizes__cuts__materials", "sizes__embroidery",
        "sizes__sewing__progress", "sizes__sewing__brigade", "sizes__packs")


def job_ready(job):
    progress = list(job.progress.all())          # упорядочено по дате: последняя — текущая
    return progress[-1].ready if progress else Decimal("0")


def job_sewn(job):
    """Сшито штук = выдано × готовность, с округлением до целой штуки."""
    return int((Decimal(job.qty) * job_ready(job)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def size_stats(size):
    jobs = list(size.sewing.all())
    assigned = sum(j.qty for j in jobs)
    sewn = sum(job_sewn(j) for j in jobs)
    packed = sum(p.qty for p in size.packs.all())
    return {
        "planned": size.planned,
        "cut": sum(c.qty for c in size.cuts.all()),
        "embroidered": sum(e.qty for e in size.embroidery.all()),
        "assigned": assigned,
        "in_sewing": assigned - sewn,
        "sewn": sewn,
        "packed": packed,
        "left": max(size.planned - packed, 0),
    }


def order_stats(order):
    total = dict.fromkeys(STAGES, 0)
    for s in order.sizes.all():
        for k, v in size_stats(s).items():
            total[k] += v
    return total


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
