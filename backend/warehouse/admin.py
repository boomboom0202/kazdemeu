from django.contrib import admin
from .models import Supplier, Material, MaterialBatch, StockMovement, FinishedGoodsMovement, PurchaseOrder
for m in (Supplier, Material, MaterialBatch, StockMovement, FinishedGoodsMovement, PurchaseOrder):
    admin.site.register(m)
