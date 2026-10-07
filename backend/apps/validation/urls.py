from rest_framework.routers import DefaultRouter
from .views import CustomRuleViewSet, LeaseRuleViewSet, RuleProposalViewSet, ValidationResultViewSet

router = DefaultRouter()
router.register('validations', ValidationResultViewSet, basename='validation')
router.register('lease-rules', LeaseRuleViewSet, basename='lease-rule')
router.register('custom-rules', CustomRuleViewSet, basename='custom-rule')
router.register('rule-proposals', RuleProposalViewSet, basename='rule-proposal')

urlpatterns = router.urls
