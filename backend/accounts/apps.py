from django.apps import AppConfig


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "accounts"

    def ready(self):
        from . import audit
        from django.apps import apps
        for label in [
            "tenders.Tender",
            "contracts.Contract", "contracts.Customer", "contracts.ContractPayment",
            "contracts.ContractExpense", "contracts.ContractFile", "contracts.Comment",
            "workshop.WorkOrder", "workshop.WorkSize", "workshop.WorkOrderStage",
            "workshop.StageTemplate", "workshop.StageEntry", "workshop.SewingJob",
            "workshop.SewingProgress", "workshop.Brigade",
            "warehouse.Material", "warehouse.MaterialBatch", "warehouse.StockMovement",
            "warehouse.GoodsMovement", "warehouse.Supplier",
            "finance.AdminCategory", "finance.AdminExpense", "finance.OtherIncome",
        ]:
            audit.register(apps.get_model(label))
