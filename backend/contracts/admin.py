from django.contrib import admin
from .models import Customer, Contract, PaymentScheduleItem, ContractFile, Comment
for m in (Customer, Contract, PaymentScheduleItem, ContractFile, Comment):
    admin.site.register(m)
