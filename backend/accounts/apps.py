from django.apps import AppConfig


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "accounts"

    def ready(self):
        from . import audit
        from django.apps import apps
        for label in [
            "contracts.Contract", "contracts.Comment", "contracts.PaymentScheduleItem",
            "contracts.ContractFile", "warehouse.Material", "warehouse.MaterialBatch",
            "warehouse.StockMovement", "production.Product", "production.ProductionOrder",
            "production.ProductionStage", "finance.CashEntry", "warehouse.PurchaseOrder",
            "finance.FixedCost", "production.StageTemplate", "tenders.Tender",
        ]:
            audit.register(apps.get_model(label))
