from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.authtoken.models import Token

from core.models import (
    AccountingSyncEvent,
    AccountingSyncRecord,
    ChangeOrderSnapshot,
    CustomerRecord,
    ChangeOrder,
    ChangeOrderLine,
    CostCode,
    Customer,
    DocumentAccessSession,
    EmailRecord,
    EmailVerificationToken,
    Estimate,
    EstimateLineItem,
    EstimateStatusEvent,
    Invoice,
    InvoiceLine,
    InvoiceStatusEvent,
    LeadContactRecord,
    OrganizationMembershipRecord,
    OrganizationRecord,
    Payment,
    PaymentAllocation,
    PaymentAllocationRecord,
    PaymentRecord,
    Project,
    Organization,
    OrganizationInvite,
    OrganizationMembership,
    RoleTemplate,
    SigningCeremonyRecord,
    VendorBill,
    VendorBillLine,
    VendorBillSnapshot,
    Vendor,
)

User = get_user_model()


def _bootstrap_org(user):
    """Bootstrap an organization for a test user and return it.

    Calls _ensure_membership to create the org + membership, then returns
    the organization. Use this in test setUp to get the org for Customer/Project creation.
    """
    from core.user_helpers import _ensure_membership

    membership = _ensure_membership(user)
    return membership.organization


__all__ = [
    "TestCase",
    "Token",
    "User",
    "AccountingSyncEvent",
    "AccountingSyncRecord",
    "ChangeOrderSnapshot",
    "CustomerRecord",
    "ChangeOrder",
    "ChangeOrderLine",
    "CostCode",
    "Customer",
    "DocumentAccessSession",
    "EmailRecord",
    "EmailVerificationToken",
    "Estimate",
    "EstimateLineItem",
    "EstimateStatusEvent",
    "Invoice",
    "InvoiceLine",
    "InvoiceStatusEvent",
    "LeadContactRecord",
    "OrganizationMembershipRecord",
    "OrganizationRecord",
    "Payment",
    "PaymentAllocation",
    "PaymentAllocationRecord",
    "PaymentRecord",
    "Project",
    "Organization",
    "OrganizationInvite",
    "OrganizationMembership",
    "RoleTemplate",
    "SigningCeremonyRecord",
    "VendorBill",
    "VendorBillLine",
    "VendorBillSnapshot",
    "Vendor",
    "_bootstrap_org",
]
