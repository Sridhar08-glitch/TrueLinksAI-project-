import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('inspections', '0003_inspection_analyzed_at'),
    ]

    operations = [
        migrations.AddField(
            model_name='inspection',
            name='updated_at',
            field=models.DateTimeField(auto_now=True, default=django.utils.timezone.now),
            preserve_default=False,
        ),
    ]
