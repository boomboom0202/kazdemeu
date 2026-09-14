from django.contrib import admin
from .models import Customer, Contract, ContractPayment, ContractExpense, ContractFile, Comment

for m in (Customer, Contract, ContractPayment, ContractExpense, ContractFile, Comment):
    admin.site.register(m)
