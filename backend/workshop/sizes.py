"""Размер изделия — по размерной сетке ГОСТ и одним написанием.

В отчёте цеха один и тот же размер пишут по-разному: «54-188», «54/188»,
«52|194», «48.182», «44 /164», «60/62-182/188». Для системы это были бы
разные размеры, а опечатка «48/192» стала бы отдельной строкой сетки.
Здесь любое такое написание приводится к одному виду, а размер, которого
в сетке не бывает, не пропускается — с объяснением, что не так.

Виды размеров:
    размер/рост       54/176, 56-58/170-176 (диапазон соседних)
    только размер     50, 56-58
    буквенный         XXS … 6XL
    без размера       изделие без размерной сетки

Размер — обхват груди пополам: чётное число от 38 до 84.
Рост — через 6 см: 98, 104 … 158, 164, 170, 176, 182, 188, 194, 200, 206, 212.
"""
import re

LETTERS = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"]
_LETTER_ALIASES = {"XXL": "2XL", "XXXL": "3XL", "XXXXL": "4XL"}
_CYRILLIC = str.maketrans("СМЛХсмлх", "SMLXsmlx")   # «ХЛ», «М», «С», набранные по-русски
ONE_SIZE = "без размера"
_ONE_SIZE_WORDS = {"без размера", "безразмера", "б/р", "бр", "единый", "единый размер", "one size", "onesize"}

CHEST_MIN, CHEST_MAX = 38, 84
HEIGHT_MIN, HEIGHT_MAX = 98, 212
# число меньше этого — размер, больше или равно — рост
_HEIGHT_FROM = 90


def is_height(n):
    return HEIGHT_MIN <= n <= HEIGHT_MAX and (n - 2) % 6 == 0


def _nearest_heights(n):
    lower = n - (n - 2) % 6
    return lower, lower + 6


def normalize_size(raw):
    """(размер одним написанием, None) или (None, почему такого размера не бывает)."""
    text = re.sub(r"\s+", " ", str(raw or "")).strip()
    if not text:
        return None, "размер не указан"
    if text.lower() in _ONE_SIZE_WORDS:
        return ONE_SIZE, None
    letter = text.translate(_CYRILLIC).upper().replace(" ", "")
    letter = _LETTER_ALIASES.get(letter, letter)
    if letter in LETTERS:
        return letter, None
    if re.search(r"[^\d\s/\\|\-–—_.,]", text):
        return None, (f"«{text}» — непонятный размер. Пишите размер/рост цифрами (54/176, 56-58/170-176), "
                      "буквами (M, XL) или «без размера»")

    nums = [int(n) for n in re.findall(r"\d+", text)]
    chest = [n for n in nums if n < _HEIGHT_FROM]
    height = [n for n in nums if n >= _HEIGHT_FROM]
    if nums != chest + height:
        return None, f"«{text}» — сначала размер, потом рост: 54/176"
    if not chest:
        return None, f"«{text}» — не указан размер: 54/176"
    if len(chest) > 2 or len(height) > 2:
        return None, f"«{text}» — лишние числа: размер/рост пишутся как 54/176 или 56-58/170-176"
    for c in chest:
        if not CHEST_MIN <= c <= CHEST_MAX or c % 2:
            return None, f"«{text}»: размера {c} нет — размеры чётные, от {CHEST_MIN} до {CHEST_MAX}"
    if len(chest) == 2 and chest[1] - chest[0] not in (2, 4):
        return None, f"«{text}»: в диапазон берут соседние размеры, например 56-58"
    for h in height:
        if not is_height(h):
            hint = ""
            if HEIGHT_MIN <= h <= HEIGHT_MAX:
                lo, hi = _nearest_heights(h)
                hint = f" Может быть, {lo} или {hi}?"
            return None, (f"«{text}»: роста {h} в размерной сетке нет — рост идёт через 6 см "
                          f"(158, 164, 170, 176…).{hint}")
    if len(height) == 2 and height[1] - height[0] not in (6, 12):
        return None, f"«{text}»: в диапазон берут соседние роста, например 170-176"

    c = "-".join(map(str, chest))
    h = "-".join(map(str, height))
    return (f"{c}/{h}" if h else c), None


def size_sort_key(size):
    """Порядок строк сетки: по размеру, внутри — по росту; буквенные после, «без размера» последним."""
    if size == ONE_SIZE:
        return (3,)
    if size in LETTERS:
        return (1, LETTERS.index(size))
    nums = [int(n) for n in re.findall(r"\d+", size or "")]
    chest = [n for n in nums if n < _HEIGHT_FROM]
    height = [n for n in nums if n >= _HEIGHT_FROM]
    if not chest:
        return (4, str(size))
    return (0, chest[0], len(chest), height[0] if height else 0, len(height))
