from django.contrib import admin
from .models import Supplier, Material, MaterialBatch, StockMovement, GoodsMovement

for m in (Supplier, Material, MaterialBatch, StockMovement, GoodsMovement):
    admin.site.register(m)
