"""Вместо справочника бригад — ответственный сотрудник и люди строкой.

За работу на этапе отвечает пользователь системы, а кто её делал руками
(бригада, несколько имён), пишут вручную: своих учётных записей у них нет.
Прежние бригады переносятся в эту строку как есть: «Наср + 9».
"""
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def brigades_to_text(apps, schema_editor):
    for name in ("StageEntry", "SewingJob"):
        model = apps.get_model("workshop", name)
        for row in model.objects.exclude(brigade=None).select_related("brigade"):
            b = row.brigade
            row.workers = f"{b.leader} + {b.people}" if b.people else b.leader
            row.save(update_fields=["workers"])


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("workshop", "0007_stageentry_brigade"),
    ]

    operations = [
        migrations.AddField(
            model_name="stageentry", name="responsible",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                                    related_name="stage_entries", to=settings.AUTH_USER_MODEL,
                                    verbose_name="Ответственный"),
        ),
        migrations.AddField(
            model_name="stageentry", name="workers",
            field=models.CharField(blank=True, max_length=255, verbose_name="Кто делал",
                                   help_text="Кто делал руками: «Наср + 9», «Акбар, Гульмира». "
                                             "Своих учётных записей у них нет"),
        ),
        migrations.AddField(
            model_name="sewingjob", name="responsible",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                                    related_name="sewing_jobs", to=settings.AUTH_USER_MODEL,
                                    verbose_name="Ответственный"),
        ),
        migrations.AddField(
            model_name="sewingjob", name="workers",
            field=models.CharField(blank=True, max_length=255, verbose_name="Кто шьёт",
                                   help_text="Кто делал руками: «Наср + 9», «Акбар, Гульмира». "
                                             "Своих учётных записей у них нет"),
        ),
        migrations.RunPython(brigades_to_text, migrations.RunPython.noop),
        migrations.RemoveField(model_name="stageentry", name="brigade"),
        migrations.RemoveField(model_name="sewingjob", name="brigade"),
        migrations.DeleteModel(name="Brigade"),
    ]
