from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('work_orders', '0002_workorder_assigned_at_workorder_assigned_to'),
    ]

    operations = [
        migrations.AddField(
            model_name='workorder',
            name='rejected_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='workorder',
            name='rejected_by',
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
    ]
