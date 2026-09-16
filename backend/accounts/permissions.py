from rest_framework.permissions import BasePermission, SAFE_METHODS

# Разделы системы — те же, что в меню
SECTIONS = ["tenders", "contracts", "workshop", "warehouse", "finance", "analytics"]

# Что роль может ЧИТАТЬ. "*" — всё. Кроме разделов целиком можно указать
# отдельную часть («contracts.contracts»): так технолог видит реестр
# договоров, но не видит, сколько по ним заплачено и потрачено.
READ_ACCESS = {
    "admin": {"*"},
    "director": {"*"},
    "manager": {"tenders", "contracts", "workshop", "warehouse", "analytics"},
    "technologist": {"contracts.contracts", "contracts.customers", "contracts.files",
                     "contracts.comments", "workshop", "warehouse"},
    "accountant": {"tenders", "contracts", "workshop", "warehouse", "finance", "analytics"},
    "warehouse": {"workshop", "warehouse"},
    "worker": {"workshop"},
    "viewer": {"tenders", "contracts.contracts", "contracts.customers", "contracts.files",
               "contracts.comments", "workshop", "warehouse", "analytics"},
}

# Что роль может ИЗМЕНЯТЬ (создавать/править/удалять)
WRITE_ACCESS = {
    "admin": {"*"},
    "director": {"tenders"},
    "manager": {"tenders", "contracts"},
    "technologist": {"workshop"},
    "accountant": {"contracts", "finance"},
    "warehouse": {"warehouse"},
    "worker": {"workshop.entries"},
    "viewer": set(),
}


# Части разделов, на которые можно выдать право отдельно от всего раздела.
# Ключ — "раздел.часть". Названия те же, что видит пользователь в интерфейсе.
AREAS = {
    "tenders": {"tenders": "Лоты и план закупок", "platforms": "Площадки",
                "companies": "Свои компании"},
    "contracts": {"contracts": "Реестр договоров", "customers": "Заказчики",
                  "payments": "Оплаты заказчиков", "expenses": "Расходы по договорам",
                  "files": "Файлы договора", "comments": "Комментарии"},
    "workshop": {"orders": "Заказы цеха и размеры",
                 "entries": "Записи этапов: крой, пошив, упаковка…",
                 "stages": "Настройка этапов"},
    "warehouse": {"materials": "Материалы и остатки", "receipts": "Приход материалов",
                  "issues": "Выдача в цех и движения", "goods": "Готовая продукция и отгрузка",
                  "suppliers": "Поставщики"},
    "finance": {"reports": "Сводка по деньгам", "admin": "Административные расходы",
                "income": "Прочие поступления"},
    "analytics": {},
}

# Все допустимые ключи: и разделы целиком, и их части
ALL_KEYS = SECTIONS + [f"{s}.{a}" for s, areas in AREAS.items() for a in areas]

NONE, READ, WRITE = "none", "read", "write"


def _role_level(user, key: str) -> str:
    """Что даёт роль на ключ, без учёта точечных правил."""
    role = getattr(user, "role", "")
    section = key.split(".")[0]
    w = WRITE_ACCESS.get(role, set())
    if "*" in w or key in w or section in w:
        return WRITE
    r = READ_ACCESS.get(role, set())
    if "*" in r or key in r or section in r:
        return READ
    return NONE


def _overrides(user) -> dict:
    """Точечные правила пользователя. Кэшируются на объекте — за запрос
    прав спрашивают многократно, а правил у человека единицы."""
    cached = getattr(user, "_access_cache", None)
    if cached is None:
        try:
            cached = {r.key: r.level for r in user.access_rules.all()}
        except Exception:
            cached = {}
        user._access_cache = cached
    return cached


def resolve(user, key: str) -> str:
    """Уровень доступа к ключу: none / read / write.

    Точечное правило важнее правила на весь раздел, любое правило важнее роли.
    Администратор не ограничивается — иначе можно случайно отобрать себе
    доступ к управлению правами и запереть систему.
    """
    if not (user and getattr(user, "is_authenticated", False)):
        return NONE
    if getattr(user, "role", "") == "admin" or getattr(user, "is_superuser", False):
        return WRITE
    if not key:
        return NONE
    rules = _overrides(user)
    if key in rules:
        return rules[key]
    section = key.split(".")[0]
    if section in rules:
        return rules[section]
    return _role_level(user, key)


def can_read(user, key: str) -> bool:
    return resolve(user, key) in (READ, WRITE)


def can_write(user, key: str) -> bool:
    return resolve(user, key) == WRITE


def effective_perms(user) -> dict:
    """Итоговые права по всем ключам — для интерфейса."""
    out = {}
    for key in ALL_KEYS:
        lvl = resolve(user, key)
        out[key] = {"read": lvl in (READ, WRITE), "write": lvl == WRITE, "level": lvl}
    return out


class RoleSectionPermission(BasePermission):
    """Чтение и запись разграничены по роли и разделу.
    ViewSet указывает атрибут `access_key` (или `section`)."""

    def has_permission(self, request, view):
        from .audit import set_current_user
        u = request.user
        set_current_user(u)
        if not (u and u.is_authenticated):
            return False
        key = getattr(view, "access_key", None) or getattr(view, "section", None)
        if request.method in SAFE_METHODS:
            return can_read(u, key)
        return can_write(u, key)


class SectionReadPermission(BasePermission):
    """Проверка доступа на чтение по ключу — для функциональных вьюх."""
    section = None

    def has_permission(self, request, view):
        u = request.user
        if not (u and u.is_authenticated):
            return False
        return can_read(u, self.section)


def section_read(name):
    """Готовый класс прав на чтение: section_read("finance.reports")."""
    return type("SectionRead_" + name.replace(".", "_"), (SectionReadPermission,), {"section": name})
