from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('inspections', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='inspection',
            name='is_deleted',
            field=models.BooleanField(default=False),
        ),
    ]
