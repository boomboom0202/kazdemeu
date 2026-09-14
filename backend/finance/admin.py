from django.contrib import admin
from .models import AdminCategory, AdminExpense, OtherIncome

for m in (AdminCategory, AdminExpense, OtherIncome):
    admin.site.register(m)
