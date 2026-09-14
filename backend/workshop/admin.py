from django.contrib import admin
from .models import StageTemplate, Brigade, WorkOrder, WorkOrderStage, WorkSize, StageEntry, SewingJob

for m in (StageTemplate, Brigade, WorkOrder, WorkOrderStage, WorkSize, StageEntry, SewingJob):
    admin.site.register(m)
