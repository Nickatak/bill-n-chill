import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.hoisted(() => vi.fn());

vi.mock("@/shared/session/use-shared-session", () => ({
  useSharedSessionAuth: vi.fn(() => ({
    token: "test-token",
    email: "owner@test.com",
    authMessage: "Using shared session for owner@test.com (owner).",
    role: "owner",
    organization: null,
    capabilities: { org_identity: ["view", "edit"], org_presets: ["view", "edit"], users: ["view", "invite"] },
  })),
}));

vi.mock("@/shared/session/client-session", () => ({
  loadClientSession: vi.fn(() => ({
    token: "test-token",
    email: "owner@test.com",
    role: "owner",
    organization: { id: 1, displayName: "Test Org" },
  })),
  saveClientSession: vi.fn(),
}));

vi.mock("@/shared/session/rbac", () => ({
  hasAnyRole: vi.fn((_role: string, roles: string[]) => roles.includes("owner")),
  canDo: vi.fn(() => true),
}));

vi.stubGlobal("fetch", mockFetch);

import { OrganizationConsole } from "../components/organization-console";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    display_name: "Test Organization",
    logo_url: "",
    help_email: "help@test.com",
    billing_street_1: "123 Main St",
    billing_street_2: "Suite 200",
    billing_city: "Springfield",
    billing_state: "IL",
    billing_zip: "62704",
    phone_number: "555-123-4567",
    website_url: "https://test.com",
    license_number: "CSLB #999",
    tax_id: "12-3456789",
    default_invoice_due_delta: 30,
    default_estimate_valid_delta: 30,
    invoice_terms_and_conditions: "Net 30",
    estimate_terms_and_conditions: "Valid 30 days",
    change_order_terms_and_conditions: "CO terms",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeMembership(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    organization: 1,
    user: 1,
    user_email: "owner@test.com",
    user_full_name: "Test Owner",
    role: "owner",
    status: "active",
    role_template: null,
    capability_flags_json: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    is_current_user: true,
    ...overrides,
  };
}

function makeInvite(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    email: "invitee@test.com",
    role: "viewer",
    role_template: null,
    role_template_name: "",
    invited_by_email: "owner@test.com",
    token: "abc123",
    expires_at: "2026-12-31T00:00:00Z",
    created_at: "2026-01-15T00:00:00Z",
    ...overrides,
  };
}

const ROLE_POLICY = {
  effective_role: "owner",
  can_edit_profile: true,
  can_manage_memberships: true,
  can_invite: true,
  editable_roles: ["owner", "pm", "bookkeeping", "worker", "viewer"],
  editable_statuses: ["active", "disabled"],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupDefaultFetch(overrides: {
  profile?: unknown;
  memberships?: unknown[];
  invites?: unknown[];
  rolePolicy?: unknown;
  profileOk?: boolean;
  membershipsOk?: boolean;
} = {}) {
  const profile = overrides.profile ?? makeProfile();
  const memberships = overrides.memberships ?? [makeMembership()];
  const invites = overrides.invites ?? [];
  const rolePolicy = overrides.rolePolicy ?? ROLE_POLICY;

  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/organization/memberships/")) {
      return Promise.resolve({
        ok: overrides.membershipsOk !== false,
        json: () =>
          Promise.resolve(
            overrides.membershipsOk === false
              ? { error: { code: "error", message: "Memberships failed", fields: {} } }
              : { data: { memberships, role_policy: rolePolicy } },
          ),
      });
    }
    if (url.includes("/organization/invites/")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: { invites } }),
      });
    }
    if (url.includes("/organization/")) {
      return Promise.resolve({
        ok: overrides.profileOk !== false,
        json: () =>
          Promise.resolve(
            overrides.profileOk === false
              ? { error: { code: "error", message: "Profile failed", fields: {} } }
              : { data: { organization: profile, active_member_count: memberships.length, role_policy: rolePolicy } },
          ),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OrganizationConsole", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  // -- Loading & mount --

  it("shows loading state while fetching", () => {
    mockFetch.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<OrganizationConsole />);
    expect(screen.getByText(/Loading organization data/i)).toBeTruthy();
  });

  it("sets onboarding org-visited localStorage flag on mount", () => {
    setupDefaultFetch();
    render(<OrganizationConsole />);
    expect(localStorage.getItem("onboarding:org-visited")).toBe("1");
  });

  // -- Tab rendering --

  it("renders three tabs and defaults to My Business", async () => {
    setupDefaultFetch();
    render(<OrganizationConsole />);
    await waitFor(() => expect(screen.getByText("Company Name")).toBeTruthy());
    expect(screen.getByText("My Business")).toBeTruthy();
    expect(screen.getByText("My Team")).toBeTruthy();
    expect(screen.getByText("Document Settings")).toBeTruthy();
  });

  it("switches to My Team tab and renders membership table", async () => {
    const members = [
      makeMembership(),
      makeMembership({ id: 2, user: 2, user_email: "pm@test.com", user_full_name: "PM User", role: "pm", is_current_user: false }),
    ];
    setupDefaultFetch({ memberships: members });
    render(<OrganizationConsole />);
    await waitFor(() => expect(screen.getByText("Company Name")).toBeTruthy());

    fireEvent.click(screen.getByText("My Team"));
    expect(screen.getByText("Test Owner")).toBeTruthy();
    expect(screen.getByText("PM User")).toBeTruthy();
  });

  it("switches to Document Settings tab and renders estimate fields by default", async () => {
    setupDefaultFetch();
    render(<OrganizationConsole />);
    await waitFor(() => expect(screen.getByText("Company Name")).toBeTruthy());

    fireEvent.click(screen.getByText("Document Settings"));
    expect(screen.getByText("Estimate Valid Days")).toBeTruthy();
  });

  // -- Error states --

  it("shows error when profile fetch fails", async () => {
    setupDefaultFetch({ profileOk: false });
    render(<OrganizationConsole />);
    await waitFor(() => expect(screen.getByText("Profile failed")).toBeTruthy());
  });

  it("shows error when memberships fetch fails", async () => {
    setupDefaultFetch({ membershipsOk: false });
    render(<OrganizationConsole />);
    await waitFor(() => expect(screen.getByText("Memberships failed")).toBeTruthy());
  });
});

// ---------------------------------------------------------------------------
// BusinessProfileTab (rendered via OrganizationConsole, business tab)
// ---------------------------------------------------------------------------

describe("OrganizationConsole > Business Profile", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders all identity and address fields with profile values", async () => {
    setupDefaultFetch();
    render(<OrganizationConsole />);
    await waitFor(() => expect(screen.getByDisplayValue("Test Organization")).toBeTruthy());

    expect(screen.getByDisplayValue("CSLB #999")).toBeTruthy();
    expect(screen.getByDisplayValue("12-3456789")).toBeTruthy();
    expect(screen.getByDisplayValue("555-123-4567")).toBeTruthy();
    expect(screen.getByDisplayValue("https://test.com")).toBeTruthy();
    expect(screen.getByDisplayValue("123 Main St")).toBeTruthy();
    expect(screen.getByDisplayValue("Suite 200")).toBeTruthy();
    expect(screen.getByDisplayValue("Springfield")).toBeTruthy();
    expect(screen.getByDisplayValue("IL")).toBeTruthy();
    expect(screen.getByDisplayValue("62704")).toBeTruthy();
  });

  it("save button is disabled when no changes are made", async () => {
    setupDefaultFetch();
    render(<OrganizationConsole />);
    await waitFor(() => expect(screen.getByDisplayValue("Test Organization")).toBeTruthy());

    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).toHaveProperty("disabled", true);
  });

  it("save button enables after changing a field", async () => {
    setupDefaultFetch();
    render(<OrganizationConsole />);
    await waitFor(() => expect(screen.getByDisplayValue("Test Organization")).toBeTruthy());

    const nameInput = screen.getByDisplayValue("Test Organization");
    fireEvent.change(nameInput, { target: { value: "New Name" } });

    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).toHaveProperty("disabled", false);
  });

  it("sends PATCH with updated fields on save", async () => {
    setupDefaultFetch();
    render(<OrganizationConsole />);
    await waitFor(() => expect(screen.getByDisplayValue("Test Organization")).toBeTruthy());

    const nameInput = screen.getByDisplayValue("Test Organization");
    fireEvent.change(nameInput, { target: { value: "Updated Org" } });

    // Mock the PATCH response
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "PATCH" && url.includes("/organization/")) {
        const body = JSON.parse(init.body as string);
        expect(body.display_name).toBe("Updated Org");
        expect(body.billing_city).toBe("Springfield");
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: { organization: makeProfile({ display_name: "Updated Org" }) },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const saveButton = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveButton);

    await waitFor(() => expect(screen.getByDisplayValue("Updated Org")).toBeTruthy());
  });

  it("shows error on save failure", async () => {
    setupDefaultFetch();
    render(<OrganizationConsole />);
    await waitFor(() => expect(screen.getByDisplayValue("Test Organization")).toBeTruthy());

    fireEvent.change(screen.getByDisplayValue("Test Organization"), {
      target: { value: "Fail Org" },
    });

    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return Promise.resolve({
          ok: false,
          json: () =>
            Promise.resolve({ error: { code: "validation", message: "Name too long", fields: {} } }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Name too long")).toBeTruthy());
  });

  it("shows read-only hint when canEdit is false", async () => {
    setupDefaultFetch({
      rolePolicy: { ...ROLE_POLICY, can_edit_profile: false },
    });
    render(<OrganizationConsole />);
    await waitFor(() => expect(screen.getByDisplayValue("Test Organization")).toBeTruthy());

    expect(screen.getByText(/read-only for business profile/i)).toBeTruthy();
  });

  it("shows logo placeholder when no logo URL", async () => {
    setupDefaultFetch();
    render(<OrganizationConsole />);
    await waitFor(() => expect(screen.getByText("No logo uploaded")).toBeTruthy());
  });

  it("shows logo preview when logo URL is present", async () => {
    setupDefaultFetch({ profile: makeProfile({ logo_url: "https://test.com/logo.png" }) });
    render(<OrganizationConsole />);
    await waitFor(() => {
      const img = screen.getByAltText("Organization logo") as HTMLImageElement;
      expect(img.src).toBe("https://test.com/logo.png");
    });
  });
});

// ---------------------------------------------------------------------------
// TeamTab (rendered via OrganizationConsole, team tab)
// ---------------------------------------------------------------------------

describe("OrganizationConsole > Team Tab", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  function renderAndSwitchToTeam(overrides: Parameters<typeof setupDefaultFetch>[0] = {}) {
    setupDefaultFetch(overrides);
    render(<OrganizationConsole />);
    return waitFor(() => expect(screen.getByText("Company Name")).toBeTruthy()).then(() => {
      fireEvent.click(screen.getByText("My Team"));
    });
  }

  it("renders membership table with member names and emails", async () => {
    const members = [
      makeMembership(),
      makeMembership({ id: 2, user: 2, user_email: "pm@test.com", user_full_name: "PM User", role: "pm", is_current_user: false }),
    ];
    await renderAndSwitchToTeam({ memberships: members });

    expect(screen.getByText("Test Owner")).toBeTruthy();
    expect(screen.getByText("owner@test.com")).toBeTruthy();
    expect(screen.getByText("PM User")).toBeTruthy();
    expect(screen.getByText("pm@test.com")).toBeTruthy();
  });

  it("shows 'You' badge for the current user", async () => {
    await renderAndSwitchToTeam();
    expect(screen.getByText("You")).toBeTruthy();
  });

  it("blocks self-editing — current user sees text instead of selects", async () => {
    await renderAndSwitchToTeam();
    // Current user row should show "You" badge
    expect(screen.getByText("You")).toBeTruthy();
    // Only the invite form's role select should exist (no membership selects for self)
    const selects = screen.queryAllByRole("combobox");
    expect(selects).toHaveLength(1); // invite role picker only
  });

  it("shows editable selects for other members", async () => {
    const members = [
      makeMembership(),
      makeMembership({ id: 2, user: 2, user_email: "pm@test.com", user_full_name: "PM User", role: "pm", is_current_user: false }),
    ];
    await renderAndSwitchToTeam({ memberships: members });

    // Non-current user should have role and status selects + invite form role select
    const selects = screen.getAllByRole("combobox");
    expect(selects.length).toBe(3); // PM role + PM status + invite role picker
  });

  it("saves membership role change via PATCH", async () => {
    const members = [
      makeMembership(),
      makeMembership({ id: 2, user: 2, user_email: "pm@test.com", user_full_name: "PM User", role: "pm", is_current_user: false }),
    ];
    await renderAndSwitchToTeam({ memberships: members });

    // Change role select for PM User
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "worker" } });

    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "PATCH" && url.includes("/organization/memberships/2/")) {
        const body = JSON.parse(init.body as string);
        expect(body.role).toBe("worker");
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                membership: { ...members[1], role: "worker" },
                role_policy: ROLE_POLICY,
              },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    // Find the Save button for the PM User's row
    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    fireEvent.click(saveButtons[0]);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/organization/memberships/2/"),
      expect.objectContaining({ method: "PATCH" }),
    ));
  });

  it("shows empty state when no memberships", async () => {
    await renderAndSwitchToTeam({ memberships: [] });
    expect(screen.getByText(/No memberships found/i)).toBeTruthy();
  });

  // -- Invite section --

  it("shows invite form when user can invite", async () => {
    await renderAndSwitchToTeam();
    expect(screen.getByText("Invite Members")).toBeTruthy();
    expect(screen.getByPlaceholderText("teammate@example.com")).toBeTruthy();
  });

  it("invite role dropdown excludes owner", async () => {
    await renderAndSwitchToTeam();
    const options = screen.getAllByRole("option").map((el) => el.textContent);
    // Membership role selects include "owner", but the invite dropdown must not.
    // The invite dropdown is the last <select> — filter to options inside it.
    const inviteSelect = screen.getByDisplayValue("viewer");
    const inviteOptions = Array.from(inviteSelect.querySelectorAll("option")).map(
      (el) => el.value,
    );
    expect(inviteOptions).not.toContain("owner");
    expect(inviteOptions).toEqual(["pm", "bookkeeping", "worker", "viewer"]);
  });

  it.each([
    { role: "pm", email: "pm@invited.com" },
    { role: "bookkeeping", email: "book@invited.com" },
    { role: "worker", email: "worker@invited.com" },
    { role: "viewer", email: "viewer@invited.com" },
  ])("invite flow for $role role", async ({ role, email }) => {
    await renderAndSwitchToTeam({ invites: [] });
    expect(screen.queryByText("Pending Invites")).toBeFalsy();

    // Fill out invite form.
    fireEvent.change(screen.getByPlaceholderText("teammate@example.com"), {
      target: { value: email },
    });
    const inviteSelect = screen.getByDisplayValue("viewer");
    fireEvent.change(inviteSelect, { target: { value: role } });

    // Mock POST 201.
    const createdAt = "2026-03-10T12:00:00Z";
    const expiresAt = "2026-03-11T12:00:00Z";
    const inviteToken = `tok_${role}`;

    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url.includes("/organization/invites/")) {
        const body = JSON.parse(init.body as string);
        expect(body.email).toBe(email);
        expect(body.role).toBe(role);
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () =>
            Promise.resolve({
              data: {
                invite: makeInvite({
                  id: 200,
                  email,
                  role,
                  token: inviteToken,
                  expires_at: expiresAt,
                  created_at: createdAt,
                }),
              },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Create Invite" }));

    // Invite link banner with correct URL.
    await waitFor(() => {
      expect(screen.getByText(/Invite Link/)).toBeTruthy();
    });
    expect(screen.getByText(`${window.location.origin}/register?token=${inviteToken}`)).toBeTruthy();

    // Pending invite card details.
    expect(screen.getByText("Pending Invites")).toBeTruthy();
    expect(screen.getByText(email)).toBeTruthy();
    expect(screen.getByText(new RegExp(`${role}.*Invited by`))).toBeTruthy();

    // Expiration date (24h from creation).
    const formattedExpiry = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(expiresAt));
    expect(screen.getByText(new RegExp(formattedExpiry))).toBeTruthy();

    // Copy Link button present.
    expect(screen.getByRole("button", { name: "Copy Link" })).toBeTruthy();
  });

  it("renders pending invites list with multiple invites", async () => {
    const invites = [
      makeInvite(),
      makeInvite({ id: 101, email: "another@test.com", role: "pm" }),
    ];
    await renderAndSwitchToTeam({ invites });

    expect(screen.getByText("Pending Invites")).toBeTruthy();
    expect(screen.getByText("invitee@test.com")).toBeTruthy();
    expect(screen.getByText("another@test.com")).toBeTruthy();
  });

  it("revokes invite via DELETE", async () => {
    const invites = [makeInvite()];
    await renderAndSwitchToTeam({ invites });

    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "DELETE" && url.includes("/organization/invites/100/")) {
        return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(screen.queryByText("invitee@test.com")).toBeFalsy());
  });
});

// ---------------------------------------------------------------------------
// DocumentSettingsTab (rendered via OrganizationConsole, documents tab)
// ---------------------------------------------------------------------------

describe("OrganizationConsole > Document Settings", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  async function renderAndSwitchToDocuments(overrides: Parameters<typeof setupDefaultFetch>[0] = {}) {
    setupDefaultFetch(overrides);
    render(<OrganizationConsole />);
    await waitFor(() => expect(screen.getByText("Company Name")).toBeTruthy());
    fireEvent.click(screen.getByText("Document Settings"));
  }

  it("renders estimate doc type sub-tab by default", async () => {
    await renderAndSwitchToDocuments();
    expect(screen.getByText("Estimate Valid Days")).toBeTruthy();
    expect(screen.getByDisplayValue("30")).toBeTruthy();
  });

  it("switches to invoice doc type sub-tab", async () => {
    await renderAndSwitchToDocuments();
    fireEvent.click(screen.getByText("Invoices"));
    expect(screen.getByText("Default Due Days")).toBeTruthy();
  });

  it("switches to change order doc type sub-tab", async () => {
    await renderAndSwitchToDocuments();
    fireEvent.click(screen.getByText("Change Orders"));
    expect(screen.getByText(/Change Order Terms/i)).toBeTruthy();
  });

  it("save button disabled with no changes", async () => {
    await renderAndSwitchToDocuments();
    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).toHaveProperty("disabled", true);
  });

  it("sends PATCH on save with document settings payload", async () => {
    await renderAndSwitchToDocuments();

    const validDaysInput = screen.getByDisplayValue("30");
    fireEvent.change(validDaysInput, { target: { value: "45" } });

    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "PATCH" && url.includes("/organization/")) {
        const body = JSON.parse(init.body as string);
        expect(body.default_estimate_valid_delta).toBe(45);
        expect(body.default_invoice_due_delta).toBe(30);
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: { organization: makeProfile({ default_estimate_valid_delta: 45 }) },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByDisplayValue("45")).toBeTruthy());
  });

  it("shows read-only hint when canEdit is false", async () => {
    await renderAndSwitchToDocuments({
      rolePolicy: { ...ROLE_POLICY, can_edit_profile: false },
    });
    expect(screen.getByText(/read-only for document settings/i)).toBeTruthy();
  });

  it("renders T&Cs textarea with profile values", async () => {
    await renderAndSwitchToDocuments();
    expect(screen.getByDisplayValue("Valid 30 days")).toBeTruthy();
  });
});
