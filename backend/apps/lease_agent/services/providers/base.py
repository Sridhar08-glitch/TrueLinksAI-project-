from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, Any


@dataclass
class ExtractedField:
    field_name: str
    raw_value: str
    normalized_value: Any
    confidence: float
    source_page: Optional[int]
    source_text: Optional[str]
    # Metadata for Layer B dynamic storage
    display_label: str = ''
    data_type: str = 'text'       # text / date / amount / number / boolean
    category: str = 'other'       # financial / parties / dates / legal / clauses / restrictions / other
    extraction_method: str = 'unknown'  # predefined / dynamic_scan / ai_structured
    has_contradiction: bool = False
    contradiction_note: str = ''


@dataclass
class ExtractionResult:
    fields: list[ExtractedField]
    provider_name: str
    raw_output: dict = field(default_factory=dict)


class LeaseExtractionProvider(ABC):
    @abstractmethod
    def extract(self, document_text: str, pages: list[dict]) -> ExtractionResult:
        """Extract structured fields from lease document text."""
