import type { SessionRole } from "@/shared/session/client-session";

export type OrganizationMembershipStatus = "active" | "disabled";

export type OrganizationProfile = {
  id: number;
  display_name: string;
  logo_url: string;
  help_email: string;
  billing_street_1: string;
  billing_street_2: string;
  billing_city: string;
  billing_state: string;
  billing_zip: string;
  phone_number: string;
  website_url: string;
  license_number: string;
  tax_id: string;
  default_invoice_due_delta: number;
  default_quote_valid_delta: number;
  invoice_terms_and_conditions: string;
  quote_terms_and_conditions: string;
  change_order_terms_and_conditions: string;
  created_at: string;
  updated_at: string;
};

export type OrganizationMembershipRecord = {
  id: number;
  organization: number;
  user: number;
  user_email: string;
  user_full_name: string;
  role: SessionRole;
  status: OrganizationMembershipStatus;
  role_template: number | null;
  capability_flags_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  is_current_user: boolean;
};

export type OrganizationRolePolicy = {
  effective_role: SessionRole;
  can_edit_profile: boolean;
  can_manage_memberships: boolean;
  can_invite?: boolean;
  editable_roles: SessionRole[];
  editable_statuses: OrganizationMembershipStatus[];
};

export type OrganizationInviteRecord = {
  id: number;
  email: string;
  role: string;
  role_template: number | null;
  role_template_name: string;
  invited_by_email: string;
  token: string;
  expires_at: string;
  created_at: string;
};

export type OrganizationProfileResponseData = {
  organization: OrganizationProfile;
  current_membership: OrganizationMembershipRecord;
  active_member_count: number;
  role_policy: OrganizationRolePolicy;
};

export type OrganizationMembershipsResponseData = {
  memberships: OrganizationMembershipRecord[];
  role_policy: OrganizationRolePolicy;
};

export type OrganizationMembershipUpdateResponseData = {
  membership: OrganizationMembershipRecord;
  role_policy: OrganizationRolePolicy;
};

export type ApiError = {
  code?: string;
  message?: string;
  fields?: Record<string, string[]>;
};

export type ApiResponse = {
  data?:
    | OrganizationProfileResponseData
    | OrganizationMembershipsResponseData
    | OrganizationMembershipUpdateResponseData
    | {
        organization?: OrganizationProfile;
        role_policy?: OrganizationRolePolicy;
      };
  meta?: {
    changed_fields?: string[];
  };
  error?: ApiError;
};
