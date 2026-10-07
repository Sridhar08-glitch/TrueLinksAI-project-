from django.contrib import admin
from .models import OwnershipEntity, Property, Building

admin.site.register(OwnershipEntity)
admin.site.register(Property)
admin.site.register(Building)
