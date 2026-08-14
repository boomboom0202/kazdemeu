from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import User, AuditLog, Notification
admin.site.register(User, UserAdmin)
admin.site.register(AuditLog)
admin.site.register(Notification)
