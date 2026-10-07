from rest_framework.routers import DefaultRouter
from .views import PaymentScheduleItemViewSet

router = DefaultRouter()
router.register('payments', PaymentScheduleItemViewSet, basename='payment')

urlpatterns = router.urls
