from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('inspections', '0004_inspection_updated_at'),
        ('units', '0001_initial'),
        ('work_orders', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='inspection',
            name='work_order',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='verification_inspections', to='work_orders.workorder'),
        ),
        migrations.CreateModel(
            name='InspectionSchedule',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=255)),
                ('description', models.TextField(blank=True)),
                ('frequency_months', models.PositiveSmallIntegerField(default=3)),
                ('next_due_date', models.DateField()),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('unit', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='inspection_schedules', to='units.unit')),
            ],
        ),
    ]
