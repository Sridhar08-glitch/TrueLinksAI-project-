from django.contrib import admin
from .models import Lease, LeaseField, LeaseFlag, LeaseClause

admin.site.register(Lease)
admin.site.register(LeaseField)
admin.site.register(LeaseFlag)
admin.site.register(LeaseClause)
