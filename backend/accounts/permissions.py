from rest_framework.permissions import BasePermission, SAFE_METHODS

# Разделы системы (секции), на которые разграничен доступ
SECTIONS = ["tenders", "contracts", "catalog", "production", "warehouse", "finance", "analytics"]

# Что роль может ЧИТАТЬ. "*" — всё.
# Строгая модель: цех не видит финансы, бухгалтер не лезет в производство и т.д.
READ_ACCESS = {
    "admin": {"*"},
    "director": {"*"},
    "manager": {"tenders", "contracts", "catalog", "production", "warehouse", "analytics"},
    "technologist": {"catalog", "production", "warehouse", "contracts"},
    "accountant": {"finance", "contracts", "tenders", "analytics"},
    "warehouse": {"warehouse", "production", "catalog"},
    "worker": {"production", "catalog"},
    "viewer": {"tenders", "contracts", "catalog", "production", "warehouse", "analytics"},
}

# Что роль может ИЗМЕНЯТЬ (создавать/править/удалять)
WRITE_ACCESS = {
    "admin": {"*"},
    "director": {"tenders"},
    "manager": {"tenders", "contracts"},
    "technologist": {"catalog", "production"},
    "accountant": {"finance", "contracts"},
    "warehouse": {"warehouse", "production"},
    "worker": {"production"},
    "viewer": set(),
}


# Части разделов, на которые можно выдать право отдельно от всего раздела.
# Ключ — "раздел.часть". Названия те же, что видит пользователь в интерфейсе.
AREAS = {
    "tenders": {"tenders": "Лоты и план закупок", "platforms": "Площадки",
                "companies": "Свои компании"},
    "contracts": {"contracts": "Договоры", "customers": "Заказчики",
                  "schedule": "График платежей", "files": "Файлы договора",
                  "comments": "Комментарии"},
    "catalog": {"products": "Изделия", "bom": "Состав изделия (BOM)",
                "routes": "Маршруты изделий", "stages": "Конструктор этапов",
                "pricelists": "Прайс-листы"},
    "production": {"orders": "Производственные заказы", "stages": "Этапы заказов"},
    "warehouse": {"materials": "Материалы", "batches": "Партии и приход",
                  "movements": "Движения материалов", "suppliers": "Поставщики",
                  "purchase": "Заявки на закуп", "fg": "Готовая продукция"},
    "finance": {"entries": "Движение денег", "fixed": "Постоянные расходы",
                "settings": "Настройки себестоимости", "reports": "Отчёты"},
    "analytics": {},
}

# Все допустимые ключи: и разделы целиком, и их части
ALL_KEYS = SECTIONS + [f"{s}.{a}" for s, areas in AREAS.items() for a in areas]

NONE, READ, WRITE = "none", "read", "write"


def _role_level(user, section: str) -> str:
    """Что даёт роль на раздел, без учёта точечных правил."""
    role = getattr(user, "role", "")
    w = WRITE_ACCESS.get(role, set())
    if "*" in w or section in w:
        return WRITE
    r = READ_ACCESS.get(role, set())
    if "*" in r or section in r:
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
    return _role_level(user, section)


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
    ViewSet указывает атрибут `section`."""

    def has_permission(self, request, view):
        from .audit import set_current_user
        u = request.user
        set_current_user(u)
        if not (u and u.is_authenticated):
            return False
        # access_key точнее section: позволяет закрыть отдельную вкладку
        key = getattr(view, "access_key", None) or getattr(view, "section", None)
        if request.method in SAFE_METHODS:
            return can_read(u, key)
        return can_write(u, key)

class SectionReadPermission(BasePermission):
    """Проверка доступа на чтение по разделу — для функциональных вьюх.

    ViewSet'ы пользуются RoleSectionPermission, а отчёты и аналитика написаны
    как @api_view и раньше стояли под голым IsAuthenticated: исходные данные
    (движения денег, постоянные расходы) были закрыты, а построенные на них
    отчёты — открыты любому вошедшему.
    """
    section = None

    def has_permission(self, request, view):
        u = request.user
        if not (u and u.is_authenticated):
            return False
        return can_read(u, self.section)


def section_read(name):
    """Готовый класс прав на чтение раздела: section_read("finance")."""
    return type("SectionRead_" + name, (SectionReadPermission,), {"section": name})
