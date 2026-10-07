from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('leases', '0002_leasefield_dynamic_metadata'),
    ]

    operations = [
        migrations.AddField(
            model_name='lease',
            name='is_cancelled',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='lease',
            name='cancel_reason',
            field=models.TextField(blank=True, default=''),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='lease',
            name='cancelled_by',
            field=models.CharField(blank=True, default='', max_length=255),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='lease',
            name='cancelled_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
