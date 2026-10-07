import fitz  # PyMuPDF


class PDFTextExtractor:
    def extract(self, file_path: str) -> dict:
        """
        Returns {'full_text': str, 'pages': [{'page_number': int, 'text': str}]}
        Raises ValueError if the file cannot be opened as a PDF.
        """
        try:
            doc = fitz.open(file_path)
        except Exception as exc:
            raise ValueError(f'Cannot open PDF: {exc}') from exc

        pages = []
        for i, page in enumerate(doc):
            pages.append({
                'page_number': i + 1,
                'text': page.get_text(),
            })
        doc.close()

        full_text = '\n'.join(p['text'] for p in pages)
        return {'full_text': full_text, 'pages': pages}
