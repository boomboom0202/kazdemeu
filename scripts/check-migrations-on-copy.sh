#!/bin/sh
# Проверка миграций на копии боевой базы — до того, как обновлять саму систему.
#
# Снимает резервную копию, поднимает рядом временный PostgreSQL, заливает в него
# копию, собирает новый образ приложения и прогоняет на копии migrate и check.
# Боевая база и работающее приложение не трогаются. В конце — цифры до и после:
# сколько было договоров, графиков платежей, кассы, записей цеха и во что они
# превратились.
#
# Запуск на сервере из ~/kazdemeu-src после git pull:
#     sh scripts/check-migrations-on-copy.sh
set -e
COMPOSE="sudo docker compose -f docker-compose.prod.yml"
STAMP=$(date +%F-%H%M)
BACKUP=~/backups/kazdemeu-$STAMP-before-migrate.sql.gz
mkdir -p ~/backups

echo ">> Резервная копия: $BACKUP"
$COMPOSE exec -T db pg_dump -U kazdemeu kazdemeu | gzip > "$BACKUP"
ls -la "$BACKUP"

count() {  # count <контейнер> <запрос>
  sudo docker exec -i "$1" psql -U kazdemeu kazdemeu -At -c "$2" 2>/dev/null || echo "—"
}
DB=$($COMPOSE ps -q db)
echo ">> Боевая база сейчас"
for t in contracts_contract contracts_paymentscheduleitem finance_cashentry finance_fixedcost \
         production_productionorder workshop_workorder workshop_cutentry workshop_sewingjob \
         warehouse_finishedgoodsmovement accounts_useraccess tenders_tender; do
  echo "   $t: $(count "$DB" "select count(*) from $t")"
done

NET=$(sudo docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$DB" | awk '{print $1}')
echo ">> Временный PostgreSQL в сети $NET"
sudo docker rm -f pgcopy >/dev/null 2>&1 || true
sudo docker run -d --name pgcopy --network "$NET" -e POSTGRES_USER=kazdemeu -e POSTGRES_PASSWORD=copy \
  -e POSTGRES_DB=kazdemeu postgres:18-alpine >/dev/null
until sudo docker exec pgcopy pg_isready -U kazdemeu >/dev/null 2>&1; do sleep 1; done
sleep 2
gunzip -c "$BACKUP" | sudo docker exec -i pgcopy psql -q -U kazdemeu kazdemeu >/dev/null

echo ">> Новый образ приложения"
$COMPOSE build app

echo ">> Миграции на копии"
$COMPOSE run --rm --no-deps --entrypoint "" \
  -e DATABASE_URL=postgresql://kazdemeu:copy@pgcopy:5432/kazdemeu -e DATABASE_SSL=0 \
  app sh -c "cd /app/backend && python manage.py migrate --noinput && python manage.py check"

echo ">> Копия после миграций"
for q in "договоры|select count(*) from contracts_contract" \
         "расходы договоров|select count(*) from contracts_contractexpense" \
         "оплаты договоров|select count(*) from contracts_contractpayment" \
         "адм. расходы|select count(*) from finance_adminexpense" \
         "статьи адм. расходов|select count(*) from finance_admincategory" \
         "прочие поступления|select count(*) from finance_otherincome" \
         "заказы цеха|select count(*) from workshop_workorder" \
         "записи этапов|select count(*) from workshop_stageentry" \
         "партии бригад|select count(*) from workshop_sewingjob" \
         "готовая продукция (движения)|select count(*) from warehouse_goodsmovement" \
         "точечные права|select count(*) from accounts_useraccess" \
         "тендеры|select count(*) from tenders_tender"; do
  echo "   ${q%%|*}: $(count pgcopy "${q#*|}")"
done

sudo docker rm -f pgcopy >/dev/null
echo ">> Готово. Если миграции прошли, обновление: $COMPOSE up -d --build"
