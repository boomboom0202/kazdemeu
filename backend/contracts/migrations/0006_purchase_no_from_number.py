from django.db import migrations, models


def fill_purchase_no(apps, schema_editor):
    """У договоров, заведённых до реестра, номером служил номер закупки —
    переносим его в новое поле, чтобы реестр узнал эти записи при загрузке."""
    Contract = apps.get_model("contracts", "Contract")
    Contract.objects.filter(purchase_no="").update(purchase_no=models.F("number"))


class Migration(migrations.Migration):

    dependencies = [
        ("contracts", "0005_contract_comment_contract_contract_no_and_more"),
    ]

    operations = [
        migrations.RunPython(fill_purchase_no, migrations.RunPython.noop),
    ]
