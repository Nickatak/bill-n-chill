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
        self.org = _bootstrap_org(self.user)
        self.other_org = _bootstrap_org(self.other_user)

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
            organization=self.org,
        )
        Vendor.objects.create(
            name="Other Vendor",
            email="other@vendor.example.com",
            created_by=self.other_user,
            organization=self.other_org,
        )

        response = self.client.get(
            "/api/v1/vendors/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        rows = response.json()["data"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["name"], "Owner Vendor")

    def test_vendor_list_includes_global_canonical_vendors(self):
        canonical = Vendor.objects.create(
            name="Global Canonical Vendor",
            email="canonical@vendor.example.com",
            created_by=self.other_user,
            is_canonical=True,
            organization=None,
        )

        response = self.client.get(
            "/api/v1/vendors/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        rows = response.json()["data"]
        returned_ids = {row["id"] for row in rows}
        self.assertIn(canonical.id, returned_ids)

    def test_vendor_list_includes_rows_created_by_other_user_in_same_org(self):
        shared_org = Organization.objects.create(
            display_name="Shared Vendor Org",
            created_by=self.user,
        )
        OrganizationMembership.objects.update_or_create(
            user=self.user,
            defaults={
                "organization": shared_org,
                "role": OrganizationMembership.Role.OWNER,
                "status": OrganizationMembership.Status.ACTIVE,
            },
        )
        OrganizationMembership.objects.update_or_create(
            user=self.other_user,
            defaults={
                "organization": shared_org,
                "role": OrganizationMembership.Role.PM,
                "status": OrganizationMembership.Status.ACTIVE,
            },
        )

        owner_vendor = Vendor.objects.create(
            name="Owner Shared Vendor",
            email="owner-shared@example.com",
            organization=shared_org,
            created_by=self.user,
        )
        shared_vendor = Vendor.objects.create(
            name="Other Shared Vendor",
            email="other-shared@example.com",
            organization=shared_org,
            created_by=self.other_user,
        )
        isolated_org = Organization.objects.create(
            display_name="Isolated Vendor Org",
            created_by=self.other_user,
        )
        isolated_vendor = Vendor.objects.create(
            name="Isolated Vendor",
            email="isolated@example.com",
            organization=isolated_org,
            created_by=self.other_user,
        )

        response = self.client.get(
            "/api/v1/vendors/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        rows = response.json()["data"]
        returned_ids = {row["id"] for row in rows}
        self.assertIn(owner_vendor.id, returned_ids)
        self.assertIn(shared_vendor.id, returned_ids)
        self.assertNotIn(isolated_vendor.id, returned_ids)

    def test_vendor_duplicate_warning_on_create_by_name_or_email(self):
        Vendor.objects.create(
            name="Tile House",
            email="billing@tilehouse.example.com",
            created_by=self.user,
            organization=self.org,
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
            organization=self.org,
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
            organization=self.org,
        )
        second = Vendor.objects.create(
            name="Drywall Team",
            email="drywall@example.com",
            created_by=self.user,
            organization=self.org,
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
            organization=self.org,
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

    def test_vendor_create_rejects_inactive_state(self):
        create = self.client.post(
            "/api/v1/vendors/",
            data={
                "name": "Inactive Vendor",
                "is_active": False,
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(create.status_code, 400)
        payload = create.json()["error"]
        self.assertEqual(payload["code"], "validation_error")
        self.assertIn("is_active", payload["fields"])

    def test_vendor_create_assigns_active_organization(self):
        membership = OrganizationMembership.objects.update_or_create(
            user=self.user,
            defaults={
                "organization": Organization.objects.create(
                    display_name="Vendor Org",
                    created_by=self.user,
                ),
                "role": OrganizationMembership.Role.OWNER,
                "status": OrganizationMembership.Status.ACTIVE,
            },
        )[0]

        response = self.client.post(
            "/api/v1/vendors/",
            data={"name": "Org Scoped Vendor", "email": "org-scoped@example.com"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        vendor = Vendor.objects.get(id=response.json()["data"]["id"])
        self.assertEqual(vendor.organization_id, membership.organization_id)

    def test_vendor_patch_updates_vendor_type(self):
        vendor = Vendor.objects.create(
            name="Switchable Vendor",
            vendor_type=Vendor.VendorType.TRADE,
            created_by=self.user,
            organization=self.org,
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

    def test_vendor_csv_import_preview_and_apply(self):
        Vendor.objects.create(
            name="Stone Supply LLC",
            vendor_type=Vendor.VendorType.TRADE,
            email="old@stone.example.com",
            created_by=self.user,
            organization=self.org,
        )

        preview = self.client.post(
            "/api/v1/vendors/import-csv/",
            data={
                "dry_run": True,
                "csv_text": "name,vendor_type,email,phone\nStone Supply LLC,trade,ap@stone.example.com,555-1111\nFraming Crew,trade,frame@example.com,555-2222\n",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(preview.status_code, 200)
        preview_data = preview.json()["data"]
        self.assertEqual(preview_data["mode"], "preview")
        self.assertEqual(preview_data["total_rows"], 2)

        apply_response = self.client.post(
            "/api/v1/vendors/import-csv/",
            data={
                "dry_run": False,
                "csv_text": "name,vendor_type,email,phone\nStone Supply LLC,trade,ap@stone.example.com,555-1111\nFraming Crew,trade,frame@example.com,555-2222\n",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(apply_response.status_code, 200)
        data = apply_response.json()["data"]
        self.assertEqual(data["updated_count"], 1)
        self.assertEqual(data["created_count"], 1)
        self.assertEqual(Vendor.objects.filter(created_by=self.user).count(), 2)

    def test_vendor_csv_import_applies_when_dry_run_string_false(self):
        response = self.client.post(
            "/api/v1/vendors/import-csv/",
            data={
                "dry_run": "false",
                "csv_text": "name,vendor_type,email,phone\nFraming Crew,trade,frame@example.com,555-2222\n",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["mode"], "apply")
        self.assertEqual(payload["created_count"], 1)
        self.assertTrue(
            Vendor.objects.filter(created_by=self.user, name="Framing Crew").exists()
        )

    def test_vendor_csv_import_rejects_is_active_header(self):
        response = self.client.post(
            "/api/v1/vendors/import-csv/",
            data={
                "dry_run": True,
                "csv_text": "name,vendor_type,email,phone,is_active\nFraming Crew,trade,frame@example.com,555-2222,true\n",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()["error"]
        self.assertEqual(payload["code"], "validation_error")
        self.assertIn("headers", payload["fields"])
