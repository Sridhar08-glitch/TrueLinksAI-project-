from django.urls import path
from rest_framework.routers import DefaultRouter
from .views import UnitViewSet
from . import dashboard, notifications, reports

router = DefaultRouter()
router.register('units', UnitViewSet, basename='unit')

urlpatterns = router.urls + [
    path('dashboard/stats/', dashboard.stats_view, name='dashboard-stats'),
    path('dashboard/monthly-stats/', dashboard.monthly_stats_view, name='dashboard-monthly-stats'),
    path('notifications/', notifications.notifications_view, name='notifications-list'),
    path('notifications/mark_all_read/', notifications.mark_all_read_view, name='notifications-mark-all'),
    path('notifications/<str:pk>/mark_read/', notifications.mark_read_view, name='notifications-mark-read'),
    path('reports/rent-roll/', reports.rent_roll_report, name='report-rent-roll'),
    path('reports/occupancy/', reports.occupancy_report, name='report-occupancy'),
    path('reports/work-orders/', reports.work_orders_report, name='report-work-orders'),
]
