from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.views.generic import TemplateView
from django.views.static import serve
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from accounts import views as acc
from tenders import views as tnd
from contracts import views as con
from workshop import views as ws
from warehouse import views as wh
from finance import views as fin
from finance import analytics_views as an
from assistant import views as ai

router = DefaultRouter()
# администрирование
router.register("users", acc.UserViewSet)
router.register("audit-log", acc.AuditLogViewSet)
router.register("user-access", acc.UserAccessViewSet)
router.register("notifications", acc.NotificationViewSet, basename="notifications")
# тендеры
router.register("tenders", tnd.TenderViewSet)
router.register("platforms", tnd.PlatformViewSet)
router.register("own-companies", tnd.OwnCompanyViewSet)
# договоры и их деньги
router.register("customers", con.CustomerViewSet)
router.register("contracts", con.ContractViewSet)
router.register("contract-payments", con.ContractPaymentViewSet)
router.register("contract-expenses", con.ContractExpenseViewSet)
router.register("contract-files", con.ContractFileViewSet)
router.register("comments", con.CommentViewSet)
# цех
router.register("stage-templates", ws.StageTemplateViewSet)
router.register("brigades", ws.BrigadeViewSet)
router.register("work-orders", ws.WorkOrderViewSet)
router.register("work-sizes", ws.WorkSizeViewSet)
router.register("stage-entries", ws.StageEntryViewSet)
router.register("sewing-jobs", ws.SewingJobViewSet)
router.register("sewing-progress", ws.SewingProgressViewSet)
# склад
router.register("suppliers", wh.SupplierViewSet)
router.register("materials", wh.MaterialViewSet)
router.register("material-batches", wh.MaterialBatchViewSet)
router.register("stock-movements", wh.StockMovementViewSet)
router.register("goods-movements", wh.GoodsMovementViewSet)
# финансы
router.register("admin-categories", fin.AdminCategoryViewSet)
router.register("admin-expenses", fin.AdminExpenseViewSet)
router.register("other-income", fin.OtherIncomeViewSet)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/token/", TokenObtainPairView.as_view()),
    path("api/auth/refresh/", TokenRefreshView.as_view()),
    path("api/me/", acc.me),
    path("api/access-keys/", acc.access_keys),
    path("api/finance/summary/", fin.summary),
    path("api/analytics/overview/", an.overview),
    path("api/ai/chat/", ai.chat),
    path("api/ai/tender/", ai.tender_proposal),
    path("api/", include(router.urls)),
    re_path(r"^media/(?P<path>.*)$", serve, {"document_root": settings.MEDIA_ROOT}),
]

# Всё остальное отдаём собранному React — он сам разбирает свои маршруты
if settings.FRONTEND_DIST.exists():
    urlpatterns += [
        re_path(
            r"^(?!api/|admin/|static/|media/).*$",
            TemplateView.as_view(template_name="index.html"),
        ),
    ]
