# SYNC

Cross-agent coordination file. Read before acting, update after decisions.

---

## Organization Console Rewrite

**Status:** Not started — design discussion phase

**Current state:** Single 898-line component (`organization-console.tsx`) with 3 sections:
1. Profile editing (display name, logo, doc presets with tabbed Invoice/Estimate/CO)
2. Membership management (role/status per member, inline save)
3. Invite members (create invite, copy link, list pending, revoke)

~20 useState hooks, all in one component. No sub-components extracted.

**Design agent:** Reviewing architecture, discussing decomposition and UX direction with Nick.

**Implementation agent:** Oriented on full codebase. Ready to code once design decisions land.

---

## Implementation Agent — Codebase Inventory

### Backend (already well-decomposed, unlikely to need restructuring)

| File | Responsibility |
|---|---|
| `views/shared_operations/organization_management.py` (269 lines) | Profile GET/PATCH, memberships GET, membership detail PATCH |
| `views/shared_operations/organization_invites.py` (170 lines) | Invites GET/POST, invite detail DELETE |
| `views/shared_operations/organization_management_helpers.py` (52 lines) | Role policy builder, membership queryset, last-owner check |
| `serializers/organization_management.py` (156 lines) | All serializers: profile, membership, invite CRUD |

**Capability gates in play:**
- `org_identity.edit` → display_name, logo_url, billing_address, phone_number, website_url, license_number, tax_id (owner only)
- `org_presets.edit` → help_email, due/valid deltas, T&Cs (owner + PM)
- `users.edit_role` → membership role/status (owner only)
- `users.invite` → create/revoke invites (owner + PM via RoleTemplate)

**API endpoints:**
- `GET/PATCH /organization/` — profile + role_policy + active_member_count
- `GET /organization/memberships/` — membership list
- `PATCH /organization/memberships/<id>/` — update role/status
- `GET/POST /organization/invites/` — list/create
- `DELETE /organization/invites/<id>/` — revoke

### Frontend (the monolith to decompose)

| File | Lines | Notes |
|---|---|---|
| `organization-console.tsx` | 899 | The monolith |
| `organization-console.module.css` | 306 | Grid layout, 700px mobile breakpoint |
| `types.ts` | 93 | OrganizationProfile, Membership, RolePolicy, Invite types |
| `api.ts` | 15 | Just base URL + normalizer |

**Natural decomposition boundaries** (maps 1:1 to backend views):
1. Profile section (identity fields + document presets)
2. Members section (list + role/status editing + self-protection guards)
3. Invites section (create form + pending list + revoke)

### Tests
- Backend: `test_organization_management.py` (~280 lines) — solid coverage
- Frontend: None yet

---

## Decisions Log

### 1. New identity fields (implemented)
Added 4 new fields to the Organization model, all optional/blank, all gated under `org_identity.edit`:
- `phone_number` — CharField(50), for document headers
- `website_url` — URLField, for document headers
- `license_number` — CharField(100), contractor license # (format varies by state, so free-text)
- `tax_id` — CharField(50), EIN/SSN for 1099 compliance

**Layers touched:** model, migration (0007), build_snapshot, serializers (read+write), view (_identity_fields + _string_fields), frontend type.

**NOT touched yet:** document branding resolver (`organization-branding.ts` / `OrganizationBrandingDefaults` type) — that's a rendering concern for when we wire these into document headers.

**Payment instructions:** Decided against a structured field. Users can put payment info in the invoice T&C textarea, which is already per-document-type.

**Default tax rate:** Deferred — that's a whole tax calculation feature, not a profile field.

### 2. Layout: 3-tab client-side tabs (decided)

**Structure:** 3 tabs within the org console, no sub-routes (URL stays `/ops/organization`).

| Tab | Label | Content |
|-----|-------|---------|
| 1 | **My Business** | Identity fields: name, logo, phone, website, license #, tax ID, billing address |
| 2 | **My Team** | Memberships list + invite form (merged — same concern: "who works here") |
| 3 | **Document Settings** | Help email, due/valid deltas, T&Cs with Invoice/Estimate/CO sub-tabs |

**Rationale:**
- Maps to how a GC owner already thinks: "my business info", "my people", "my paperwork settings"
- Single-purpose visits — owner usually comes to do one of these three things, not all at once
- Mobile-friendly — no scrolling past 20 irrelevant fields

**This pattern does NOT propagate to artifact consoles** (estimates, invoices, COs, vendor bills). Those are single-artifact workflows where sections relate to each other. Tabs there would confuse non-tech users. Tabs are for management pages with genuinely independent concerns.

### 3. Component decomposition (decided)

Each tab becomes its own component file inside `features/organization/components/`:
- `business-profile-tab.tsx` — identity fields + save
- `team-tab.tsx` — memberships + invites
- `document-settings-tab.tsx` — presets with doc-type sub-tabs
- `organization-console.tsx` — slim orchestrator: fetches data, renders tab bar, passes props down

---

## Open Questions

_(resolved questions moved to Decisions Log above)_
