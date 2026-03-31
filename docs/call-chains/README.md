# Call Chain Documentation

Per-domain call chain docs trace the chronological function-call order for each user-facing action across the full stack.

**Purpose:** Human debugging and auditing. These docs help a developer quickly trace "what calls what" from button click to database write (and back) without reading through every file.

**Not a source of truth.** Call chains are manually written, point-in-time references. They will drift as code changes — line anchors go stale, functions get renamed or moved. Treat them as a debugging aid, not a contract. When you find a stale anchor, fix it.

## Domains

- [auth.md](auth.md) — Registration, login, email verification, session verification, RBAC-gated requests
- [customers.md](customers.md) — Customer list, edit, project creation, quick-add intake
- [change-orders.md](change-orders.md) — CO page initialization, line item local ID race condition, add-line flow
- [quotes.md](quotes.md) — Quote CRUD, status transitions, clone/duplicate, public signing ceremony
- [invoices.md](invoices.md) — Invoice CRUD, status transitions, line composition, send/email, public decision
- [public-signing.md](public-signing.md) — OTP-verified e-sign ceremony for public document approval links

## Format

Each action gets an `h2` heading. Layer boundaries use horizontal rules (`---`). Phases within a layer use italic separators.

```markdown
## Action Name

`FRONTEND` — [`ComponentName`](../../frontend/path/to/file.tsx#L42)

- [`handler()`](../../frontend/path/to/file.tsx#L100)
  - `fetch POST /api/v1/resource/`

---

`BACKEND` — [`view_function`](../../backend/core/views/domain.py#L50)

*── validation ──*

- [`_capability_gate(user, "resource", "action")`](../../backend/core/rbac.py#L104)
- [`Serializer.is_valid()`](../../backend/core/serializers/domain.py#L15)

*── persist ──*

- `Model.objects.create(…)`
- [`AuditRecord.record(…)`](../../backend/core/models/financial_auditing/record.py#L66)

---

`HTTP 201` → `FRONTEND`

- [`onSuccess(data)`](../../frontend/path/to/file.tsx#L120)
  - state update / navigation
```

Nested calls that have their own internal phases use indented sub-phases:

```markdown
- [`_orchestrator_function(…)`](../../backend/path/to/file.py#L50)
  - `Model.objects.filter(…).first()`
  - *── sub-phase a ──*
  - [`helper_a(…)`](../../backend/path/to/file.py#L70)
  - `AnotherModel.objects.create(…)`
  - [`AuditRecord.record(…)`](../../backend/path/to/record.py#L66)
    - [`model.build_snapshot()`](../../backend/path/to/model.py#L44)
    - [`AuditRecord.objects.create(…)`](../../backend/path/to/record.py#L8)
  - *── sub-phase b ──*
  - [`helper_b(…)`](../../backend/path/to/file.py#L90)
```

## Conventions

- **Links:** Use relative markdown links with `#L` line anchors: `[funcName](../../path/to/file.py#L42)`.
- **Layer labels:** Use backtick-wrapped labels: `` `FRONTEND` ``, `` `BACKEND` ``, `` `HTTP 201` → `FRONTEND` ``.
- **Phase separators:** Italic with em-dashes: `*── phase name ──*`.
- **Nesting:** Indent with bullet lists to show call depth.
- **ORM calls:** Plain inline code (no link) for standard Django ORM: `` `Model.objects.create(…)` ``.
- **Staleness disclaimer:** Every call chain doc must include: `> Line anchors are pinned manually. Update after refactors that move function definitions.`
- **Combined phases:** When multiple domain phases run inside a single transaction or orchestrator, use a combined header and indent domain labels as inline sub-phases:

```markdown
*── atomic: user + membership + invite consumption ──*

- `transaction.atomic():`
  - `User.objects.create_user()`
  - *── membership ──*
  - [`OrganizationMembership.objects.create(…)`](…)
  - [`AuditRecord.record(…)`](…)
  - *── invite consumption ──*
  - `invite.save(update_fields=["consumed_at"])`
```
