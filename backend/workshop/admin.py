from django.contrib import admin
from .models import StageTemplate, WorkOrder, WorkOrderStage, WorkSize, StageEntry, SewingJob

for m in (StageTemplate, WorkOrder, WorkOrderStage, WorkSize, StageEntry, SewingJob):
    admin.site.register(m)
