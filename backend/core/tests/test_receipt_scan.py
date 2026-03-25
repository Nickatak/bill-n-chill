from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile

from core.tests.common import *


class ReceiptScanTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="scan-user",
            email="scan-user@example.com",
            password="secret123",
        )
        self.token, _ = Token.objects.get_or_create(user=self.user)
        self.org = _bootstrap_org(self.user)
        self.url = "/api/v1/vendor-bills/scan/"

    def test_scan_requires_authentication(self):
        image = SimpleUploadedFile("receipt.jpg", b"fake-image-data", content_type="image/jpeg")
        response = self.client.post(self.url, {"image": image})
        self.assertEqual(response.status_code, 401)

    @patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"})
    def test_scan_rejects_missing_image(self):
        response = self.client.post(
            self.url,
            {},
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
            format="multipart",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "validation_error")
        self.assertIn("image", response.json()["error"]["fields"])

    @patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"})
    def test_scan_rejects_unsupported_content_type(self):
        pdf_file = SimpleUploadedFile("receipt.pdf", b"fake-pdf-data", content_type="application/pdf")
        response = self.client.post(
            self.url,
            {"image": pdf_file},
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
            format="multipart",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "validation_error")
        self.assertIn("Unsupported image type", response.json()["error"]["message"])

    @patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"})
    def test_scan_rejects_image_too_large(self):
        # 5 MB + 1 byte exceeds the limit
        oversized_data = b"x" * (5 * 1024 * 1024 + 1)
        big_image = SimpleUploadedFile("big.jpg", oversized_data, content_type="image/jpeg")
        response = self.client.post(
            self.url,
            {"image": big_image},
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
            format="multipart",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "validation_error")
        self.assertIn("5 MB", response.json()["error"]["message"])

    @patch.dict("os.environ", {"GEMINI_API_KEY": ""})
    def test_scan_returns_503_when_gemini_api_key_not_configured(self):
        image = SimpleUploadedFile("receipt.jpg", b"fake-image-data", content_type="image/jpeg")
        response = self.client.post(
            self.url,
            {"image": image},
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
            format="multipart",
        )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "service_unavailable")

    @patch.dict("os.environ", {"GEMINI_API_KEY": ""})
    def test_scan_accepts_all_allowed_content_types(self):
        """All four allowed types pass content-type validation (hit 503 for missing API key, not 400)."""
        for ct, ext in [
            ("image/jpeg", "receipt.jpg"),
            ("image/png", "receipt.png"),
            ("image/webp", "receipt.webp"),
            ("image/heic", "receipt.heic"),
        ]:
            image = SimpleUploadedFile(ext, b"fake-image-data", content_type=ct)
            response = self.client.post(
                self.url,
                {"image": image},
                HTTP_AUTHORIZATION=f"Token {self.token.key}",
                format="multipart",
            )
            # Should pass validation and hit 503 (no API key), not 400
            self.assertEqual(response.status_code, 503, f"Expected 503 for {ct}, got {response.status_code}")

    def test_scan_requires_vendor_bills_create_capability(self):
        """A viewer (no vendor_bills.create capability) gets 403."""
        viewer_user = User.objects.create_user(
            username="scan-viewer",
            email="scan-viewer@example.com",
            password="secret123",
        )
        viewer_token, _ = Token.objects.get_or_create(user=viewer_user)
        # Add viewer to the same org
        OrganizationMembership.objects.create(
            organization=self.org,
            user=viewer_user,
            role=OrganizationMembership.Role.VIEWER,
            status=OrganizationMembership.Status.ACTIVE,
        )
        image = SimpleUploadedFile("receipt.jpg", b"fake-image-data", content_type="image/jpeg")
        response = self.client.post(
            self.url,
            {"image": image},
            HTTP_AUTHORIZATION=f"Token {viewer_token.key}",
            format="multipart",
        )
        self.assertEqual(response.status_code, 403)
