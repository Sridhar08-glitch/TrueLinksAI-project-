from django.db.models import Count, Q
from rest_framework import viewsets
from rest_framework.filters import SearchFilter
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend

from apps.users.permissions import ReadStaffWriteOwnerManager
from .models import Property, Building, OwnershipEntity
from .serializers import (
    PropertySerializer, PropertyCreateSerializer,
    BuildingSerializer, BuildingCreateSerializer,
    OwnershipEntitySerializer,
)


class OwnershipEntityViewSet(viewsets.ModelViewSet):
    queryset = OwnershipEntity.objects.all().order_by('name')
    serializer_class = OwnershipEntitySerializer
    permission_classes = [IsAuthenticated, ReadStaffWriteOwnerManager]


class PropertyViewSet(viewsets.ModelViewSet):
    queryset = (
        Property.objects
        .select_related('ownership_entity')
        .prefetch_related('buildings')
        .annotate(
            total_units_count=Count('buildings__units', distinct=True),
            occupied_units_count=Count(
                'buildings__units',
                filter=Q(buildings__units__occupancy_status='occupied'),
                distinct=True,
            ),
            available_units_count=Count(
                'buildings__units',
                filter=Q(buildings__units__occupancy_status='available'),
                distinct=True,
            ),
        )
        .all()
        .order_by('name')
    )
    permission_classes = [IsAuthenticated, ReadStaffWriteOwnerManager]
    filter_backends = [DjangoFilterBackend, SearchFilter]
    search_fields = ['name', 'location', 'external_property_id']

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return PropertyCreateSerializer
        return PropertySerializer


class BuildingViewSet(viewsets.ModelViewSet):
    queryset = Building.objects.select_related('property').all().order_by('property__name', 'name')
    permission_classes = [IsAuthenticated, ReadStaffWriteOwnerManager]
    filter_backends = [SearchFilter]
    search_fields = ['name', 'property__name', 'address']

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return BuildingCreateSerializer
        return BuildingSerializer
