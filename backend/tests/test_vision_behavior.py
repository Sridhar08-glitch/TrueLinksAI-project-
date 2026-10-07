"""
Vision provider behavior tests.
Tests that findings use evidence-bounded language, no false claims about
damage age/cause, idempotency, and different scenario recognition.
"""
import pytest
import os
import io
import tempfile
from PIL import Image
from apps.inspections.services.mock_vision_provider import MockVisionProvider
from apps.inspections.services.image_validation_service import ImageValidationService, ImageValidationError


@pytest.fixture
def provider():
    return MockVisionProvider()


@pytest.fixture
def validator():
    return ImageValidationService()


def make_jpeg(filename=None) -> str:
    """Create a real valid JPEG using Pillow. Returns file path."""
    img = Image.new('RGB', (100, 100), color=(120, 80, 60))
    tmp = tempfile.NamedTemporaryFile(
        suffix='.jpg', prefix=filename or 'test_', delete=False
    )
    img.save(tmp.name, 'JPEG')
    tmp.close()
    return tmp.name


def make_png(filename=None) -> str:
    img = Image.new('RGB', (100, 100), color=(60, 120, 80))
    tmp = tempfile.NamedTemporaryFile(
        suffix='.png', prefix=filename or 'test_', delete=False
    )
    img.save(tmp.name, 'PNG')
    tmp.close()
    return tmp.name


# ─── Evidence-bounded language ───────────────────────────────────────────────

class TestEvidenceBoundedLanguage:
    FORBIDDEN_CLAIMS = [
        'caused by', 'definitely', 'certainly', 'proven', 'confirmed',
        'tenant damage', 'landlord responsible', 'years old', 'months old',
        'hidden defect', 'structural failure', 'will fail',
    ]

    def test_no_damage_cause_claim(self, provider):
        path = make_jpeg('bathroom_damage_test')
        try:
            findings = provider.analyze(1, path)
            for f in findings:
                desc = f.damage_description.lower()
                for forbidden in self.FORBIDDEN_CLAIMS:
                    assert forbidden not in desc, \
                        f"Finding contains forbidden claim '{forbidden}': {f.damage_description}"
        finally:
            os.unlink(path)

    def test_damage_findings_include_uncertainty_language(self, provider):
        path = make_jpeg('bathroom_damage_report')
        try:
            findings = provider.analyze(1, path)
            damage_findings = [f for f in findings if f.category == 'damage']
            for f in damage_findings:
                uncertainty_phrases = [
                    'cannot be determined', 'age and cause', 'visible',
                    'from the image alone', 'observed'
                ]
                desc_lower = f.damage_description.lower() + f.evidence.lower()
                has_uncertainty = any(phrase in desc_lower for phrase in uncertainty_phrases)
                assert has_uncertainty, \
                    f"Damage finding lacks uncertainty language: '{f.damage_description}'"
        finally:
            os.unlink(path)

    def test_no_hidden_defect_claim(self, provider):
        path = make_jpeg('ceiling_stain_test')
        try:
            findings = provider.analyze(1, path)
            for f in findings:
                assert 'hidden' not in f.damage_description.lower()
                assert 'hidden' not in f.evidence.lower()
        finally:
            os.unlink(path)

    def test_confidence_is_bounded(self, provider):
        path = make_jpeg('kitchen_inspection_test')
        try:
            findings = provider.analyze(1, path)
            for f in findings:
                assert f.confidence is not None
                assert 0.0 <= f.confidence <= 1.0, f"Confidence out of range: {f.confidence}"
        finally:
            os.unlink(path)

    def test_image_id_attached_to_finding(self, provider):
        path = make_jpeg('bathroom_evidence_link')
        try:
            findings = provider.analyze(image_id=42, image_path=path)
            for f in findings:
                assert f.image_id == 42, f"Finding not linked to image. Got {f.image_id}"
        finally:
            os.unlink(path)


# ─── Scenario recognition ────────────────────────────────────────────────────

class TestScenarioRecognition:
    def test_bathroom_keyword_triggers_water_stain_finding(self, provider):
        path = make_jpeg('bathroom_wall_report')
        try:
            findings = provider.analyze(1, path)
            categories = [f.category for f in findings]
            assert 'damage' in categories, "Bathroom image should trigger a damage finding"
        finally:
            os.unlink(path)

    def test_kitchen_keyword_triggers_equipment_finding(self, provider):
        path = make_jpeg('kitchen_full_inspection')
        try:
            findings = provider.analyze(1, path)
            categories = [f.category for f in findings]
            assert 'equipment' in categories or 'fixture' in categories
        finally:
            os.unlink(path)

    def test_hvac_keyword_triggers_equipment_finding(self, provider):
        path = make_jpeg('hvac_unit_check')
        try:
            findings = provider.analyze(1, path)
            equipment = [f for f in findings if f.category == 'equipment']
            assert len(equipment) > 0
        finally:
            os.unlink(path)

    def test_unknown_image_returns_general_finding(self, provider):
        path = make_jpeg('random_unnamed_photo_abc123')
        try:
            findings = provider.analyze(1, path)
            assert len(findings) > 0, "Should always return at least one finding"
            assert findings[0].category == 'general'
        finally:
            os.unlink(path)

    def test_findings_always_non_empty(self, provider):
        for i in range(5):
            path = make_jpeg(f'test_photo_{i}_xyz')
            try:
                findings = provider.analyze(i, path)
                assert len(findings) > 0
            finally:
                os.unlink(path)


# ─── Image validation ────────────────────────────────────────────────────────

class TestImageValidation:
    def _make_upload(self, path, name=None, content_type='image/jpeg'):
        from django.core.files.uploadedfile import SimpleUploadedFile
        with open(path, 'rb') as f:
            data = f.read()
        return SimpleUploadedFile(name or os.path.basename(path), data, content_type=content_type)

    def test_valid_jpeg_passes(self, validator):
        path = make_jpeg()
        try:
            upload = self._make_upload(path)
            validator.validate(upload)  # should not raise
        finally:
            os.unlink(path)

    def test_valid_png_passes(self, validator):
        path = make_png()
        try:
            upload = self._make_upload(path, name='test.png', content_type='image/png')
            validator.validate(upload)
        finally:
            os.unlink(path)

    def test_pdf_rejected(self, validator):
        from django.core.files.uploadedfile import SimpleUploadedFile
        upload = SimpleUploadedFile('doc.pdf', b'%PDF-1.4 fake content', content_type='application/pdf')
        with pytest.raises(ImageValidationError) as exc:
            validator.validate(upload)
        assert 'content type' in str(exc.value).lower() or 'unsupported' in str(exc.value).lower()

    def test_wrong_extension_rejected(self, validator):
        path = make_jpeg()
        try:
            from django.core.files.uploadedfile import SimpleUploadedFile
            with open(path, 'rb') as f:
                data = f.read()
            upload = SimpleUploadedFile('image.bmp', data, content_type='image/jpeg')
            with pytest.raises(ImageValidationError) as exc:
                validator.validate(upload)
            assert 'extension' in str(exc.value).lower()
        finally:
            os.unlink(path)

    def test_corrupted_jpeg_rejected(self, validator):
        from django.core.files.uploadedfile import SimpleUploadedFile
        upload = SimpleUploadedFile('corrupt.jpg', b'not a real image at all', content_type='image/jpeg')
        with pytest.raises(ImageValidationError) as exc:
            validator.validate(upload)
        assert 'valid image' in str(exc.value).lower()

    def test_oversized_file_rejected(self, validator, settings):
        settings.MAX_UPLOAD_SIZE_MB = 1
        big_data = b'x' * (2 * 1024 * 1024)  # 2 MB
        from django.core.files.uploadedfile import SimpleUploadedFile
        upload = SimpleUploadedFile('big.jpg', big_data, content_type='image/jpeg')
        with pytest.raises(ImageValidationError) as exc:
            validator.validate(upload)
        assert 'size' in str(exc.value).lower() or 'exceeds' in str(exc.value).lower()


# ─── Work order generation from vision findings ──────────────────────────────

class TestWorkOrderFromVision:
    @pytest.mark.django_db
    def test_damage_finding_generates_work_order(self, available_unit):
        from apps.inspections.models import Inspection, InspectionFinding, FindingCategory
        from apps.work_orders.models import WorkOrder
        from apps.work_orders.services.work_order_generator import WorkOrderGenerator

        insp = Inspection.objects.create(unit=available_unit, reporter_type='inspector')
        finding = InspectionFinding.objects.create(
            inspection=insp,
            category=FindingCategory.DAMAGE,
            equipment_name='Bathroom Wall',
            condition='poor',
            damage_description='Visible water staining; age and cause cannot be determined from the image alone.',
            confidence=0.80,
            evidence='Discoloration visible.',
        )
        orders = WorkOrderGenerator().generate_from_inspection(insp.id)
        assert len(orders) == 1
        assert orders[0].status == 'draft'
        assert 'cannot be determined' in orders[0].description or 'water stain' in orders[0].description.lower() or 'poor' in orders[0].description.lower()

    @pytest.mark.django_db
    def test_general_finding_does_not_generate_work_order(self, available_unit):
        from apps.inspections.models import Inspection, InspectionFinding, FindingCategory
        from apps.work_orders.services.work_order_generator import WorkOrderGenerator

        insp = Inspection.objects.create(unit=available_unit, reporter_type='inspector')
        InspectionFinding.objects.create(
            inspection=insp,
            category=FindingCategory.GENERAL,
            condition='good',
            confidence=0.55,
        )
        orders = WorkOrderGenerator().generate_from_inspection(insp.id)
        assert len(orders) == 0, "General findings should not generate work orders"

    @pytest.mark.django_db
    def test_high_confidence_damage_gets_high_priority(self, available_unit):
        from apps.inspections.models import Inspection, InspectionFinding, FindingCategory
        from apps.work_orders.services.work_order_generator import WorkOrderGenerator

        insp = Inspection.objects.create(unit=available_unit, reporter_type='inspector')
        InspectionFinding.objects.create(
            inspection=insp, category=FindingCategory.DAMAGE,
            condition='critical', confidence=0.95, equipment_name='Ceiling',
            damage_description='Visible collapse risk.',
        )
        orders = WorkOrderGenerator().generate_from_inspection(insp.id)
        assert orders[0].priority == 'urgent'

    @pytest.mark.django_db
    def test_low_confidence_damage_gets_lower_priority(self, available_unit):
        from apps.inspections.models import Inspection, InspectionFinding, FindingCategory
        from apps.work_orders.services.work_order_generator import WorkOrderGenerator

        insp = Inspection.objects.create(unit=available_unit, reporter_type='inspector')
        InspectionFinding.objects.create(
            inspection=insp, category=FindingCategory.DAMAGE,
            condition='minor', confidence=0.55, equipment_name='Paint',
            damage_description='Minor scratch visible.',
        )
        orders = WorkOrderGenerator().generate_from_inspection(insp.id)
        assert orders[0].priority == 'high'  # damage category always at least high
