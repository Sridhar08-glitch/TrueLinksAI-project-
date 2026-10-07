from django.db import models


class OwnershipEntity(models.Model):
    name = models.CharField(max_length=255, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = 'ownership entities'

    def __str__(self):
        return self.name


class Property(models.Model):
    external_property_id = models.CharField(max_length=50, unique=True)
    ownership_entity = models.ForeignKey(
        OwnershipEntity, on_delete=models.PROTECT, related_name='properties'
    )
    name = models.CharField(max_length=255)
    location = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = 'properties'

    def __str__(self):
        return self.name


class Building(models.Model):
    external_building_id = models.CharField(max_length=50, unique=True)
    property = models.ForeignKey(
        Property, on_delete=models.CASCADE, related_name='buildings'
    )
    name = models.CharField(max_length=255)
    floors = models.PositiveIntegerField(default=1)
    address = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True, null=True)

    def __str__(self):
        return f'{self.property.name} — {self.name}'
