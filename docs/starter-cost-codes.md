# Default Cost Codes (ICP v1)

Last reviewed: 2026-02-28

Default catalog CSV for small-to-mid residential GC/remodel workflows:

- [`docs/starter-cost-codes.csv`](./starter-cost-codes.csv)

## Bootstrap Behavior

- New organizations created by auth bootstrap now auto-seed this catalog.
- Seed path is idempotent per organization + code.

## Backfill Existing Organizations

Use management command:

```bash
backend/.venv/bin/python backend/manage.py seed_default_cost_codes --org-id <ORG_ID>
```

Seed all organizations:

```bash
backend/.venv/bin/python backend/manage.py seed_default_cost_codes --all-orgs
```
