from django.contrib import admin
from .models import PaymentScheduleItem


@admin.register(PaymentScheduleItem)
class PaymentScheduleItemAdmin(admin.ModelAdmin):
    list_display = ('id', 'lease', 'due_date', 'amount', 'currency', 'status', 'paid_at')
    list_filter = ('status',)
    date_hierarchy = 'due_date'
