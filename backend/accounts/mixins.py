"""Общие миксины для ViewSet'ов."""
from django.db.models import ProtectedError
from rest_framework import status
from rest_framework.response import Response


class SafeDestroyMixin:
    """Возвращает понятную ошибку 409 вместо 500, если запись защищена связями
    (например, материал используется в спецификации BOM, а клиент — в договоре)."""

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        try:
            self.perform_destroy(instance)
        except ProtectedError:
            return Response(
                {"detail": "Нельзя удалить: запись используется в других данных. "
                           "Сначала удалите или отвяжите связанные записи."},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)
