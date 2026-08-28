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


def can_read(user, section: str) -> bool:
    allowed = READ_ACCESS.get(getattr(user, "role", ""), set())
    return "*" in allowed or section in allowed


def can_write(user, section: str) -> bool:
    allowed = WRITE_ACCESS.get(getattr(user, "role", ""), set())
    return "*" in allowed or section in allowed


class RoleSectionPermission(BasePermission):
    """Чтение и запись разграничены по роли и разделу.
    ViewSet указывает атрибут `section`."""

    def has_permission(self, request, view):
        from .audit import set_current_user
        u = request.user
        set_current_user(u)
        if not (u and u.is_authenticated):
            return False
        section = getattr(view, "section", None)
        if request.method in SAFE_METHODS:
            return can_read(u, section)
        return can_write(u, section)

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
