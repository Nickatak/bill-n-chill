"""Helpers for receipt views — shared queries and logic."""


def _prefetch_receipt_qs(queryset):
    """Eagerly load receipt relations to prevent N+1 query problems.

    Without this, serializing a list of receipts would fire separate SQL
    queries for each receipt's project, store, and payments — scaling
    linearly with the number of rows.

    - select_related: JOINs project + store in a single query (FK lookups).
    - prefetch_related: batches a second query for reverse-FK payments
      (``target_payments``) and maps results back in Python.
    """
    return queryset.select_related("project", "store").prefetch_related(
        "target_payments",
    )
