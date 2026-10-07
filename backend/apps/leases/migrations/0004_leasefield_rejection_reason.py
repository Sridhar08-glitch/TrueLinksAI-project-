from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('leases', '0003_lease_cancel_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='leasefield',
            name='rejection_reason',
            field=models.CharField(blank=True, max_length=500, null=True),
        ),
    ]
