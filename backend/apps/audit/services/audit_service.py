from apps.audit.models import AuditEvent


class AuditService:
    @staticmethod
    def log(entity_type: str, entity_id: int, action: str, actor: str,
            previous_value=None, new_value=None) -> AuditEvent:
        return AuditEvent.objects.create(
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            actor=actor,
            previous_value=previous_value,
            new_value=new_value,
        )
