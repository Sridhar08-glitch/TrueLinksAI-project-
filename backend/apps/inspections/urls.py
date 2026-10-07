from rest_framework.routers import DefaultRouter
from .views import InspectionViewSet, InspectionFindingViewSet, InspectionScheduleViewSet

router = DefaultRouter()
router.register('inspections', InspectionViewSet, basename='inspection')
router.register('inspection-findings', InspectionFindingViewSet, basename='inspection-finding')
router.register('inspection-schedules', InspectionScheduleViewSet, basename='inspection-schedule')

urlpatterns = router.urls
