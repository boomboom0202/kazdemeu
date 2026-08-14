from django.contrib import admin
from .models import Product, BOMItem, PriceList, PriceListItem, ProductionOrder, ProductionStage
for m in (Product, BOMItem, PriceList, PriceListItem, ProductionOrder, ProductionStage):
    admin.site.register(m)
