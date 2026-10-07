from django.conf import settings
from PIL import Image
import io

ALLOWED_CONTENT_TYPES = {'image/jpeg', 'image/png', 'image/webp'}
ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp'}


class ImageValidationError(Exception):
    pass


class ImageValidationService:
    def validate(self, uploaded_file) -> None:
        max_bytes = getattr(settings, 'MAX_UPLOAD_SIZE_MB', 20) * 1024 * 1024
        if uploaded_file.size > max_bytes:
            raise ImageValidationError(
                f'Image exceeds maximum size of {settings.MAX_UPLOAD_SIZE_MB}MB.'
            )

        content_type = uploaded_file.content_type.lower()
        if content_type not in ALLOWED_CONTENT_TYPES:
            raise ImageValidationError(
                f'Unsupported content type "{content_type}". Allowed: {", ".join(ALLOWED_CONTENT_TYPES)}.'
            )

        import os
        ext = os.path.splitext(uploaded_file.name)[1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise ImageValidationError(
                f'Unsupported extension "{ext}". Allowed: {", ".join(ALLOWED_EXTENSIONS)}.'
            )

        uploaded_file.seek(0)
        try:
            img = Image.open(io.BytesIO(uploaded_file.read()))
            img.verify()
        except Exception as exc:
            raise ImageValidationError(f'File is not a valid image: {exc}') from exc
        finally:
            uploaded_file.seek(0)
