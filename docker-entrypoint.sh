#!/bin/sh
set -e
cd /app/backend

echo ">> Миграции"
python manage.py migrate --noinput

# Страховка от блокировки: без администратора в систему не войти вообще
python manage.py bootstrap_admin

# seed_demo идемпотентен (get_or_create) — введённые данные не затираются
if [ "$SEED_DEMO" = "1" ]; then
  echo ">> Демо-данные"
  python manage.py seed_demo
fi

echo ">> Запуск gunicorn на порту ${PORT:-8000}"
exec gunicorn config.wsgi:application \
  --bind "0.0.0.0:${PORT:-8000}" \
  --workers "${WEB_CONCURRENCY:-2}" \
  --timeout 120 \
  --access-logfile - \
  --error-logfile -
