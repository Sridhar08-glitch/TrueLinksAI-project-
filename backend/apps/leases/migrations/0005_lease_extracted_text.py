from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('leases', '0004_leasefield_rejection_reason'),
    ]

    operations = [
        migrations.AddField(
            model_name='lease',
            name='extracted_text',
            field=models.TextField(blank=True, null=True),
        ),
    ]
