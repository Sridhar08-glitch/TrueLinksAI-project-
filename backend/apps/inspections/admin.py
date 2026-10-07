from django.contrib import admin
from .models import Inspection, InspectionImage, InspectionFinding

admin.site.register(Inspection)
admin.site.register(InspectionImage)
admin.site.register(InspectionFinding)
