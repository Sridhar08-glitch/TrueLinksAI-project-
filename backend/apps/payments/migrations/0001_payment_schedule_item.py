from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('leases', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='PaymentScheduleItem',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('due_date', models.DateField()),
                ('amount', models.DecimalField(decimal_places=2, max_digits=12)),
                ('currency', models.CharField(blank=True, max_length=10)),
                ('status', models.CharField(choices=[('pending', 'Pending'), ('paid', 'Paid'), ('overdue', 'Overdue')], default='pending', max_length=20)),
                ('paid_at', models.DateTimeField(blank=True, null=True)),
                ('paid_amount', models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ('payment_method', models.CharField(blank=True, max_length=100)),
                ('recorded_by', models.CharField(blank=True, max_length=255)),
                ('notes', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('lease', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='payments', to='leases.lease')),
            ],
            options={
                'ordering': ['due_date'],
                'indexes': [models.Index(fields=['status'], name='payments_item_status_idx'), models.Index(fields=['due_date'], name='payments_item_due_date_idx')],
                'unique_together': {('lease', 'due_date')},
            },
        ),
    ]
