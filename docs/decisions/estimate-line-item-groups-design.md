# Estimate Line Item Groups — Design

Source: PM feedback (2026-03-28). Line items need visual grouping (categories).

## Concept

Groups are opt-in category labels. Line items work exactly as they do today without groups.
A group is a named header row with a computed total (sum of its children). It has no
quantity, unit price, or markup of its own.

## Model Changes

### New model: `EstimateLineItemGroup`

| Field      | Type                  | Notes                              |
|------------|-----------------------|------------------------------------|
| `estimate` | FK(Estimate, CASCADE) | Parent estimate                    |
| `name`     | CharField(255)        | Group label (e.g. "Equipment Mobilization (Tractor)") |
| `order`    | PositiveIntegerField  | Sort position among groups and ungrouped items |

- `ordering = ["order"]`
- `unique_together = ("estimate", "order")`

### Changes to `EstimateLineItem`

| Field   | Type                                      | Notes                          |
|---------|-------------------------------------------|--------------------------------|
| `group` | FK(EstimateLineItemGroup, SET_NULL, null)  | Nullable — ungrouped if null   |
| `order` | PositiveIntegerField(default=0)            | Sort position within the group (or among ungrouped items) |

- Change `Meta.ordering` from `["id"]` to `["order"]`

### Design decisions

- **SET_NULL on group delete** — deleting a group orphans its line items back to ungrouped, not CASCADE delete.
- **Group total is computed, never stored** — sum of child `line_total` values, calculated at serialization time.
- **Order gaps are allowed** — no DB unique constraint on line item order. Sort by it, don't enforce density. Reordering just swaps/reassigns values without needing to shuffle every row.
- **Group order is unique per estimate** — DB enforced via `unique_together`.

## UX

### Desktop
- "Add Group" button (separate from "Add Line Item")
- Drag-and-drop to reorder groups and line items (within and between groups)
- Group header row shows name + computed total, no qty/price fields

### Mobile
- Same "Add Group" button
- Up/down arrows on group headers to reorder groups
- Up/down arrows on line items to reorder within their group
- "Group" dropdown field on each line item to assign/reassign to a group (or "None")
- No drag-and-drop

### Shared
- Ungrouped line items render above grouped items by default
- Creating a group does not require line items — empty groups are allowed
- Groups are purely presentational; they don't affect totals, tax, or markup calculation

## API

- Groups and line items returned separately in the estimate response
- Both carry an `order` field in the same ordering space
- Frontend merges and interleaves by `order` for display
- No polymorphic list — keeps the API RESTful

## Resolved Questions

1. **Ungrouped items render above groups** — default position is top, so an estimate with no groups looks identical to today.
2. **Shared ordering space** — groups and ungrouped line items interleave freely. A single `order` value on both models determines position at the estimate level. Group A, then two loose items, then Group B is a valid layout. Reorder logic is uniform: everything is a row with a position.
