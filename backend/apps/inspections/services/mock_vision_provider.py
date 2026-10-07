import os
from dataclasses import dataclass
from typing import Optional


@dataclass
class VisionFinding:
    category: str
    equipment_name: str
    condition: str
    damage_description: str
    confidence: float
    evidence: str
    image_id: Optional[int] = None


class MockVisionProvider:
    """
    Deterministic mock vision analysis provider.
    Returns findings based on image filename to allow predictable testing.
    Uses careful, evidence-bounded language — never claims cause or age of damage.
    """

    PROVIDER_NAME = 'mock_vision'

    SCENARIO_MAP = {
        'kitchen': [
            VisionFinding('equipment', 'Kitchen Appliances', 'fair',
                          'Visible wear on countertop surface; age and cause cannot be determined from the image alone.',
                          0.72, 'Surface discoloration visible in image.'),
            VisionFinding('fixture', 'Kitchen Sink', 'good', '', 0.80,
                          'Sink and fittings visible, no obvious damage observed.'),
        ],
        'bathroom': [
            VisionFinding('damage', 'Bathroom Wall', 'poor',
                          'Visible water staining on wall surface; age, origin, and extent of underlying damage cannot be determined from the image alone.',
                          0.68, 'Discoloration pattern consistent with water contact.'),
            VisionFinding('fixture', 'Bathroom Fixtures', 'fair', '', 0.75,
                          'Fixtures visible; minor surface wear noted.'),
        ],
        'hvac': [
            VisionFinding('equipment', 'HVAC Unit', 'fair',
                          'Dust accumulation visible on unit exterior. Operational status cannot be assessed from image.',
                          0.78, 'Dust visible on grille and casing.'),
        ],
        'ceiling': [
            VisionFinding('damage', 'Ceiling Surface', 'poor',
                          'Visible staining on ceiling; cause and extent cannot be determined from the image alone.',
                          0.65, 'Irregular discoloration pattern visible.'),
        ],
        'floor': [
            VisionFinding('damage', 'Floor Surface', 'fair',
                          'Visible scratching or scuffing on floor surface; age and cause cannot be determined from the image alone.',
                          0.70, 'Surface marks visible across an area of the floor.'),
        ],
    }

    DEFAULT_FINDINGS = [
        VisionFinding('general', 'Room — General', 'fair',
                      'Image analyzed. No specific damage identified in visible areas. Condition appears fair based on visible surfaces only.',
                      0.55, 'General room condition assessment.'),
    ]

    def analyze(self, image_id: int, image_path: str) -> list[VisionFinding]:
        filename = os.path.basename(image_path).lower()
        findings = []
        for keyword, scenario_findings in self.SCENARIO_MAP.items():
            if keyword in filename:
                for f in scenario_findings:
                    findings.append(VisionFinding(
                        category=f.category,
                        equipment_name=f.equipment_name,
                        condition=f.condition,
                        damage_description=f.damage_description,
                        confidence=f.confidence,
                        evidence=f.evidence,
                        image_id=image_id,
                    ))
        if not findings:
            for f in self.DEFAULT_FINDINGS:
                findings.append(VisionFinding(
                    category=f.category,
                    equipment_name=f.equipment_name,
                    condition=f.condition,
                    damage_description=f.damage_description,
                    confidence=f.confidence,
                    evidence=f.evidence,
                    image_id=image_id,
                ))
        return findings
