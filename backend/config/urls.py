from django.contrib import admin
from django.urls import path, include, re_path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.common.media import serve_protected_media

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
    path('api/v1/users/', include('apps.users.urls')),
    path('api/v1/', include('apps.properties.urls')),
    path('api/v1/', include('apps.units.urls')),
    path('api/v1/', include('apps.leases.urls')),
    path('api/v1/', include('apps.payments.urls')),
    path('api/v1/', include('apps.validation.urls')),
    path('api/v1/', include('apps.inspections.urls')),
    path('api/v1/', include('apps.work_orders.urls')),
    path('api/v1/', include('apps.audit.urls')),
    # Protected media — every media URL requires a valid signed token (?token=...).
    re_path(r'^media/(?P<path>.*)$', serve_protected_media, name='protected-media'),
]
