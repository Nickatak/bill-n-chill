from core.tests.common import *


class VendorTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="pm16",
            email="pm16@example.com",
            password="secret123",
        )
        self.other_user = User.objects.create_user(
            username="pm17",
            email="pm17@example.com",
            password="secret123",
        )
        self.token, _ = Token.objects.get_or_create(user=self.user)
        self.other_token, _ = Token.objects.get_or_create(user=self.other_user)

    def test_vendor_create_and_search(self):
        create = self.client.post(
            "/api/v1/vendors/",
            data={
                "name": "Stone Supply LLC",
                "email": "ap@stone.example.com",
                "phone": "555-2200",
                "tax_id_last4": "7788",
                "notes": "Preferred tile supplier.",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(create.status_code, 201)
        payload = create.json()["data"]
        self.assertEqual(payload["name"], "Stone Supply LLC")
        self.assertEqual(payload["tax_id_last4"], "7788")
        self.assertEqual(payload["vendor_type"], Vendor.VendorType.TRADE)
        self.assertFalse(payload["is_canonical"])

        list_all = self.client.get(
            "/api/v1/vendors/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(list_all.status_code, 200)
        self.assertEqual(len(list_all.json()["data"]), 1)

        search = self.client.get(
            "/api/v1/vendors/?q=stone",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(search.status_code, 200)
        self.assertEqual(len(search.json()["data"]), 1)

    def test_vendor_list_scoped_by_user(self):
        Vendor.objects.create(
            name="Owner Vendor",
            email="owner@vendor.example.com",
            created_by=self.user,
        )
        Vendor.objects.create(
            name="Other Vendor",
            email="other@vendor.example.com",
            created_by=self.other_user,
        )

        response = self.client.get(
            "/api/v1/vendors/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        rows = response.json()["data"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["name"], "Owner Vendor")

    def test_vendor_duplicate_warning_on_create_by_name_or_email(self):
        Vendor.objects.create(
            name="Tile House",
            email="billing@tilehouse.example.com",
            created_by=self.user,
        )

        duplicate_by_name = self.client.post(
            "/api/v1/vendors/",
            data={
                "name": "tile house",
                "email": "new@vendor.example.com",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(duplicate_by_name.status_code, 409)
        self.assertEqual(duplicate_by_name.json()["error"]["code"], "duplicate_detected")
        self.assertEqual(Vendor.objects.filter(created_by=self.user).count(), 1)

        duplicate_by_email = self.client.post(
            "/api/v1/vendors/",
            data={
                "name": "Different Name",
                "email": "billing@tilehouse.example.com",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(duplicate_by_email.status_code, 409)
        self.assertEqual(duplicate_by_email.json()["error"]["code"], "duplicate_detected")

    def test_vendor_duplicate_override_allows_create(self):
        Vendor.objects.create(
            name="Concrete Co",
            email="ap@concrete.example.com",
            created_by=self.user,
        )

        response = self.client.post(
            "/api/v1/vendors/",
            data={
                "name": "Concrete Co",
                "email": "ap2@concrete.example.com",
                "duplicate_override": True,
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            Vendor.objects.filter(created_by=self.user, name__iexact="Concrete Co").count(),
            2,
        )
        self.assertTrue(response.json()["meta"]["duplicate_override_used"])

    def test_vendor_patch_duplicate_warning_and_override(self):
        first = Vendor.objects.create(
            name="Framing Team",
            email="frame@example.com",
            created_by=self.user,
        )
        second = Vendor.objects.create(
            name="Drywall Team",
            email="drywall@example.com",
            created_by=self.user,
        )

        blocked = self.client.patch(
            f"/api/v1/vendors/{second.id}/",
            data={"name": "Framing Team"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(blocked.json()["error"]["code"], "duplicate_detected")

        allowed = self.client.patch(
            f"/api/v1/vendors/{second.id}/",
            data={"name": "Framing Team", "duplicate_override": True},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(allowed.status_code, 200)
        second.refresh_from_db()
        self.assertEqual(second.name, "Framing Team")

        first_response = self.client.get(
            f"/api/v1/vendors/{first.id}/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(first_response.status_code, 200)

    def test_vendor_patch_updates_fields(self):
        vendor = Vendor.objects.create(
            name="Electrical One",
            email="old@example.com",
            phone="555-1010",
            tax_id_last4="1234",
            notes="Old note",
            created_by=self.user,
        )

        response = self.client.patch(
            f"/api/v1/vendors/{vendor.id}/",
            data={
                "name": "Electrical One Updated",
                "email": "new@example.com",
                "phone": "555-2020",
                "tax_id_last4": "5678",
                "notes": "Updated note",
                "is_active": False,
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        vendor.refresh_from_db()
        self.assertEqual(vendor.name, "Electrical One Updated")
        self.assertEqual(vendor.email, "new@example.com")
        self.assertEqual(vendor.phone, "555-2020")
        self.assertEqual(vendor.tax_id_last4, "5678")
        self.assertEqual(vendor.notes, "Updated note")
        self.assertFalse(vendor.is_active)

    def test_vendor_create_accepts_retail_vendor_type(self):
        create = self.client.post(
            "/api/v1/vendors/",
            data={
                "name": "Home Depot",
                "vendor_type": Vendor.VendorType.RETAIL,
                "email": "",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(create.status_code, 201)
        payload = create.json()["data"]
        self.assertEqual(payload["vendor_type"], Vendor.VendorType.RETAIL)
        self.assertFalse(payload["is_canonical"])

    def test_vendor_patch_updates_vendor_type(self):
        vendor = Vendor.objects.create(
            name="Switchable Vendor",
            vendor_type=Vendor.VendorType.TRADE,
            created_by=self.user,
        )
        response = self.client.patch(
            f"/api/v1/vendors/{vendor.id}/",
            data={"vendor_type": Vendor.VendorType.RETAIL},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        vendor.refresh_from_db()
        self.assertEqual(vendor.vendor_type, Vendor.VendorType.RETAIL)
