"""Старые записи цеха (крой, вышивка, упаковка) перенесены в записи этапов
миграцией 0003 — их таблицы удаляются, а партия бригады теперь обязана
принадлежать этапу заказа."""
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('workshop', '0003_convert_entries'),
    ]

    operations = [
        migrations.DeleteModel(name='CutMaterial'),
        migrations.DeleteModel(name='CutEntry'),
        migrations.DeleteModel(name='EmbroideryEntry'),
        migrations.DeleteModel(name='PackEntry'),
        migrations.AlterField(
            model_name='sewingjob',
            name='stage',
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='jobs',
                                    to='workshop.workorderstage'),
        ),
    ]
