from rest_framework import viewsets, mixins
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend

from apps.users.permissions import IsOwnerOrManager
from .models import AuditEvent
from .serializers import AuditEventSerializer


class AuditEventViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    queryset = AuditEvent.objects.all().order_by('-timestamp')
    serializer_class = AuditEventSerializer
    permission_classes = [IsAuthenticated, IsOwnerOrManager]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['entity_type', 'entity_id', 'action']
