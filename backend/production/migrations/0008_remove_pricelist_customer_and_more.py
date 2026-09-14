"""Удаление таблиц убранного раздела «Изделия и нормы».

Таблицы удаляются целиком, от зависимых к тем, на кого они ссылаются.
Пошаговое снятие связей, которое генерирует makemigrations, на SQLite
падает: пересборка таблицы натыкается на уникальность по уже снятому полю.
"""
from django.db import migrations


class Migration(migrations.Migration):

    # Таблицы каталога удаляются последними: сначала производственные заказы
    # переносятся в цех (workshop.0003), готовая продукция — на склад
    # (warehouse.0006/0007), а у тендера убирается ссылка на изделие (tenders.0002).
    dependencies = [
        ('production', '0007_alter_bomitem_options_alter_pricelist_options_and_more'),
        ('warehouse', '0007_remove_purchaseorder_material_and_more'),
        ('workshop', '0003_convert_entries'),
        ('tenders', '0002_remove_tender_product_alter_tender_cost_per_unit'),
    ]

    operations = [
        migrations.DeleteModel(name='ProductionStage'),
        migrations.DeleteModel(name='ProductRouteStage'),
        migrations.DeleteModel(name='BOMItem'),
        migrations.DeleteModel(name='PriceListItem'),
        migrations.DeleteModel(name='PriceList'),
        migrations.DeleteModel(name='ProductionOrder'),
        migrations.DeleteModel(name='StageTemplate'),
        migrations.DeleteModel(name='Product'),
    ]
