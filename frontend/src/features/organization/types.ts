import type { SessionRole } from "@/features/session/client-session";

export type OrganizationMembershipStatus = "active" | "disabled";

export type OrganizationProfile = {
  id: number;
  display_name: string;
  slug: string | null;
  logo_url: string;
  invoice_sender_name: string;
  invoice_sender_email: string;
  invoice_sender_address: string;
  invoice_default_due_days: number;
  estimate_validation_delta_days: number;
  invoice_default_terms: string;
  estimate_default_terms: string;
  change_order_default_reason: string;
  invoice_default_footer: string;
  invoice_default_notes: string;
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
  editable_roles: SessionRole[];
  editable_statuses: OrganizationMembershipStatus[];
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
