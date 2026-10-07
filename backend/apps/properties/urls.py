from rest_framework.routers import DefaultRouter
from .views import PropertyViewSet, BuildingViewSet, OwnershipEntityViewSet

router = DefaultRouter()
router.register('ownership-entities', OwnershipEntityViewSet, basename='ownership-entity')
router.register('properties', PropertyViewSet, basename='property')
router.register('buildings', BuildingViewSet, basename='building')

urlpatterns = router.urls
