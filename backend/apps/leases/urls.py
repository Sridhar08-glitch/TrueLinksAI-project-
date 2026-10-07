from rest_framework.routers import DefaultRouter
from .views import LeaseViewSet, LeaseFieldViewSet, LeaseFlagViewSet, LeaseClauseViewSet

router = DefaultRouter()
router.register('leases', LeaseViewSet, basename='lease')
router.register('lease-fields', LeaseFieldViewSet, basename='lease-field')
router.register('lease-flags', LeaseFlagViewSet, basename='lease-flag')
router.register('lease-clauses', LeaseClauseViewSet, basename='lease-clause')

urlpatterns = router.urls
