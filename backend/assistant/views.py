import requests
from django.conf import settings
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from .context import build_db_context

SYSTEM_PROMPT = """Ты — AI-ассистент ERP-системы швейного цеха (тігін цехы).
Отвечай на казахском или русском — на языке вопроса пользователя.
Тебе дан срез базы: тендеры, договоры с оплатами и расходами, заказы цеха по этапам, склад, финансы.
Правила:
- Отвечай только на основе данных из среза; если данных нет — честно скажи об этом.
- Приводи конкретные цифры и номера договоров/артикулы.
- Для запросов о цене/тендере: найди похожие договоры, посмотри, сколько по ним ушло на ткань,
  фурнитуру, пошив и доставку (строки расходов), и предложи цену с обоснованием маржи.
- Формат — краткий, деловой; таблицы в markdown при необходимости."""


NOT_CONNECTED = ("AI-ассистент не подключён: на сервере нет ключа Anthropic. "
                 "Обратитесь к администратору системы.")


def ai_error(err):
    # «не подключён» — не временный сбой: 501, чтобы интерфейс не повторял запрос
    return Response({"detail": err}, status=501 if err == NOT_CONNECTED else 502)


def _call_claude(messages, system):
    if not settings.ANTHROPIC_API_KEY:
        return None, NOT_CONNECTED
    resp = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": settings.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": "claude-sonnet-4-6",
            "max_tokens": 1500,
            "system": system,
            "messages": messages,
        },
        timeout=60,
    )
    if resp.status_code != 200:
        return None, f"Ошибка Anthropic API: {resp.status_code} {resp.text[:300]}"
    data = resp.json()
    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    return text, None


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def chat(request):
    """Вопрос-ответ по всей базе на естественном языке.
    body: { "messages": [{role, content}, ...] } — история диалога."""
    messages = request.data.get("messages") or []
    if not messages:
        return Response({"detail": "Напишите вопрос."}, status=400)
    system = SYSTEM_PROMPT + "\n\n<database_snapshot>\n" + build_db_context(request.user) + "\n</database_snapshot>"
    text, err = _call_claude(messages, system)
    if err:
        return ai_error(err)
    return Response({"reply": text})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def tender_proposal(request):
    """Черновик ценового предложения для тендера на основе похожих заказов.
    body: { "description": "..." }"""
    desc = request.data.get("description", "").strip()
    if not desc:
        return Response({"detail": "Опишите лот тендера."}, status=400)
    system = SYSTEM_PROMPT + "\n\n<database_snapshot>\n" + build_db_context(request.user) + "\n</database_snapshot>"
    prompt = (f"Подготовь проект ценового предложения для тендера.\nОписание лота: {desc}\n\n"
              "1) Найди 2–3 похожих изделия/договора из базы и укажи их цены.\n"
              "2) Оцени себестоимость по расходам похожих договоров: ткань, фурнитура, пошив, доставка.\n"
              "3) Предложи цену за единицу и общую сумму с маржой, дай диапазон (мин/рекоменд/макс).\n"
              "4) Короткий текст предложения для заказчика.")
    text, err = _call_claude([{"role": "user", "content": prompt}], system)
    if err:
        return ai_error(err)
    return Response({"reply": text})
