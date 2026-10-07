import uuid
from rest_framework import serializers
from .models import OwnershipEntity, Property, Building


class OwnershipEntitySerializer(serializers.ModelSerializer):
    class Meta:
        model = OwnershipEntity
        fields = ['id', 'name', 'created_at']


class BuildingSerializer(serializers.ModelSerializer):
    unit_count = serializers.SerializerMethodField()
    units_count = serializers.SerializerMethodField()
    property_name = serializers.CharField(source='property.name', read_only=True)

    class Meta:
        model = Building
        fields = [
            'id', 'external_building_id', 'property', 'property_name',
            'name', 'floors', 'address', 'unit_count', 'units_count', 'created_at',
        ]

    def get_unit_count(self, obj):
        return obj.units.count()

    def get_units_count(self, obj):
        return obj.units.count()


class BuildingCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Building
        fields = ['external_building_id', 'property', 'name', 'floors', 'address']
        extra_kwargs = {
            'external_building_id': {'required': False, 'allow_blank': True},
            'floors': {'required': False},
            'address': {'required': False, 'allow_blank': True},
        }

    def create(self, validated_data):
        import uuid
        if not validated_data.get('external_building_id'):
            validated_data['external_building_id'] = f'BLDG-{uuid.uuid4().hex[:8].upper()}'
        return super().create(validated_data)


class PropertySerializer(serializers.ModelSerializer):
    ownership_entity = OwnershipEntitySerializer(read_only=True)
    ownership_entity_id = serializers.PrimaryKeyRelatedField(
        queryset=OwnershipEntity.objects.all(), source='ownership_entity', write_only=True
    )
    buildings = BuildingSerializer(many=True, read_only=True)
    total_units = serializers.SerializerMethodField()
    occupied_units = serializers.SerializerMethodField()
    available_units = serializers.SerializerMethodField()

    class Meta:
        model = Property
        fields = [
            'id', 'external_property_id', 'name', 'location',
            'ownership_entity', 'ownership_entity_id', 'buildings',
            'total_units', 'occupied_units', 'available_units',
            'created_at',
        ]

    # Counts are read from queryset annotations set in the viewset (single query);
    # fall back to direct queries when the serializer is used on a plain instance.
    def get_total_units(self, obj):
        annotated = getattr(obj, 'total_units_count', None)
        if annotated is not None:
            return annotated
        from apps.units.models import Unit
        return Unit.objects.filter(building__property=obj).count()

    def get_occupied_units(self, obj):
        annotated = getattr(obj, 'occupied_units_count', None)
        if annotated is not None:
            return annotated
        from apps.units.models import Unit
        return Unit.objects.filter(building__property=obj, occupancy_status='occupied').count()

    def get_available_units(self, obj):
        annotated = getattr(obj, 'available_units_count', None)
        if annotated is not None:
            return annotated
        from apps.units.models import Unit
        return Unit.objects.filter(building__property=obj, occupancy_status='available').count()


class PropertyCreateSerializer(serializers.ModelSerializer):
    ownership_entity_name = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = Property
        fields = ['external_property_id', 'name', 'location', 'ownership_entity', 'ownership_entity_name']
        extra_kwargs = {
            'ownership_entity': {'required': False, 'allow_null': True},
            'external_property_id': {'required': False, 'allow_blank': True},
        }

    def create(self, validated_data):
        ownership_entity_name = validated_data.pop('ownership_entity_name', None)
        if not validated_data.get('ownership_entity'):
            entity_name = ownership_entity_name or validated_data.get('name', 'Default')
            entity, _ = OwnershipEntity.objects.get_or_create(name=entity_name)
            validated_data['ownership_entity'] = entity
        if not validated_data.get('external_property_id'):
            validated_data['external_property_id'] = f'PROP-{uuid.uuid4().hex[:8].upper()}'
        return super().create(validated_data)
