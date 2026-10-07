from rest_framework import serializers
from .models import Unit
from apps.properties.serializers import BuildingSerializer


class UnitSerializer(serializers.ModelSerializer):
    building_name = serializers.CharField(source='building.name', read_only=True)
    property_name = serializers.CharField(source='building.property.name', read_only=True)
    property_id = serializers.CharField(source='building.property.external_property_id', read_only=True)

    class Meta:
        model = Unit
        fields = [
            'id', 'external_unit_id', 'label', 'unit_type', 'bedrooms', 'bathrooms',
            'area_sqm', 'parking_bay', 'floor_number', 'occupancy_status',
            'is_archived', 'building', 'building_name', 'property_name', 'property_id',
            'created_at', 'updated_at',
        ]


class UnitCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Unit
        fields = [
            'external_unit_id', 'building', 'label', 'unit_type',
            'bedrooms', 'bathrooms', 'area_sqm', 'parking_bay',
            'floor_number', 'occupancy_status',
        ]
        extra_kwargs = {
            'external_unit_id': {'required': False, 'allow_blank': True},
        }

    def create(self, validated_data):
        if not validated_data.get('external_unit_id'):
            import uuid
            validated_data['external_unit_id'] = f'UNIT-{uuid.uuid4().hex[:8].upper()}'
        return super().create(validated_data)


class UnitDetailSerializer(serializers.ModelSerializer):
    building = BuildingSerializer(read_only=True)
    property_name = serializers.CharField(source='building.property.name', read_only=True)
    property_id = serializers.CharField(source='building.property.external_property_id', read_only=True)

    class Meta:
        model = Unit
        fields = [
            'id', 'external_unit_id', 'label', 'unit_type', 'bedrooms', 'bathrooms',
            'area_sqm', 'parking_bay', 'floor_number', 'occupancy_status',
            'is_archived', 'building', 'property_name', 'property_id',
            'created_at', 'updated_at',
        ]
