from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.views.generic import TemplateView
from django.views.static import serve
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from accounts import views as acc
from contracts import views as con
from warehouse import views as wh
from production import views as prod
from finance import views as fin
from finance import analytics_views as an
from tenders import views as tnd
from assistant import views as ai

router = DefaultRouter()
# accounts
router.register("users", acc.UserViewSet)
router.register("audit-log", acc.AuditLogViewSet)
router.register("user-access", acc.UserAccessViewSet)
router.register("notifications", acc.NotificationViewSet, basename="notifications")
# contracts
router.register("customers", con.CustomerViewSet)
router.register("contracts", con.ContractViewSet)
router.register("payment-schedule", con.PaymentScheduleViewSet)
router.register("contract-files", con.ContractFileViewSet)
router.register("comments", con.CommentViewSet)
# warehouse
router.register("suppliers", wh.SupplierViewSet)
router.register("materials", wh.MaterialViewSet)
router.register("material-batches", wh.MaterialBatchViewSet)
router.register("stock-movements", wh.StockMovementViewSet)
router.register("finished-goods", wh.FinishedGoodsViewSet)
router.register("purchase-orders", wh.PurchaseOrderViewSet)
# production
router.register("products", prod.ProductViewSet)
router.register("stage-templates", prod.StageTemplateViewSet)
router.register("bom-items", prod.BOMItemViewSet)
router.register("product-route", prod.ProductRouteStageViewSet)
router.register("price-lists", prod.PriceListViewSet)
router.register("price-list-items", prod.PriceListItemViewSet)
router.register("production-orders", prod.ProductionOrderViewSet)
router.register("production-stages", prod.ProductionStageViewSet)
# finance
router.register("expense-categories", fin.ExpenseCategoryViewSet)
router.register("cash-entries", fin.CashEntryViewSet)
router.register("fixed-costs", fin.FixedCostViewSet)
# tenders
router.register("tenders", tnd.TenderViewSet)
router.register("platforms", tnd.PlatformViewSet)
router.register("own-companies", tnd.OwnCompanyViewSet)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/token/", TokenObtainPairView.as_view()),
    path("api/auth/refresh/", TokenRefreshView.as_view()),
    path("api/me/", acc.me),
    path("api/access-keys/", acc.access_keys),
    path("api/cost-settings/", fin.cost_settings),
    path("api/reports/cashflow/", fin.cashflow_report),
    path("api/reports/pnl/", fin.pnl_report),
    path("api/reports/forecast/", fin.forecast_report),
    path("api/reports/fixed-costs-fact/", fin.fixed_costs_plan_fact),
    path("api/analytics/products/", an.product_analytics),
    path("api/analytics/contracts/", an.contracts_status_analytics),
    path("api/analytics/dashboard/", an.dashboard),
    path("api/analytics/stock-value/", an.stock_value),
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
