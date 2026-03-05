"""Shared CSV import logic for preview/apply workflows.

Handles the common boilerplate of CSV parsing, header validation, row iteration
with error accumulation, and dry-run vs apply branching. Entity-specific behavior
is injected via callbacks.
"""

import csv
from io import StringIO


def process_csv_import(
    *,
    csv_text: str,
    dry_run: bool,
    required_headers: set[str],
    allowed_headers: set[str],
    entity_name: str,
    lookup_existing_fn,
    create_fn,
    update_fn,
    validate_row_fn=None,
    serialize_row_fn=None,
) -> tuple[list[dict], dict]:
    """Parse CSV text and process each row through lookup/create/update callbacks.

    Args:
        csv_text: Raw CSV string including header row.
        dry_run: When True, report would_create/would_update without mutating.
        required_headers: Headers that must be present (subset check).
        allowed_headers: Full set of recognized headers (superset of required).
        entity_name: Singular label for error messages (e.g. "cost code", "vendor").
        lookup_existing_fn: callable(row_dict) -> existing instance or None.
        create_fn: callable(row_dict) -> new instance. Called only when not dry_run.
        update_fn: callable(existing, row_dict) -> updated instance. Called only
            when not dry_run.
        validate_row_fn: Optional callable(row_dict) -> error message string or None.
            Called before lookup. Return a message to skip the row as an error.
        serialize_row_fn: Optional callable(instance_or_None, status, row_dict,
            row_number, message) -> dict. Override the default row output.
            ``status`` is one of "created", "updated", "would_create",
            "would_update", or "error". ``message`` is the auto-generated message
            (or the validate_row_fn error string for error rows). If not provided,
            a default dict with row_number, status, message, and all row fields
            is built.

    Returns:
        Tuple of (rows_out, summary) where rows_out is a list of per-row result
        dicts and summary is a dict with keys: entity, mode, total_rows,
        created_count, updated_count, error_count.

    Raises:
        CsvImportError: On empty input or header validation failure. Callers should
            catch this and return the ``error_payload`` as a 400 response body.
    """
    if not csv_text or not str(csv_text).strip():
        raise CsvImportError(
            code="validation_error",
            message="csv_text is required.",
            fields={"csv_text": ["Provide CSV content with headers."]},
        )

    reader = csv.DictReader(StringIO(str(csv_text)))
    incoming_headers = set(reader.fieldnames or [])

    if not required_headers.issubset(incoming_headers):
        sorted_required = ", ".join(sorted(required_headers))
        optional = allowed_headers - required_headers
        if optional:
            sorted_optional = ", ".join(sorted(optional))
            expected_msg = f"Expected at least: {sorted_required}. Optional: {sorted_optional}."
        else:
            expected_msg = f"Expected: {sorted_required}."
        raise CsvImportError(
            code="validation_error",
            message=f"CSV headers are invalid for {entity_name} import.",
            fields={
                "headers": [
                    f"{expected_msg} Found: {', '.join(sorted(incoming_headers))}"
                ]
            },
        )

    unknown_headers = incoming_headers - allowed_headers
    if unknown_headers:
        raise CsvImportError(
            code="validation_error",
            message="CSV contains unsupported headers.",
            fields={
                "headers": [f"Unsupported: {', '.join(sorted(unknown_headers))}."]
            },
        )

    rows_out: list[dict] = []
    created_count = 0
    updated_count = 0
    error_count = 0

    for index, raw_row in enumerate(reader, start=2):
        # Strip all values up front.
        row = {k: (v or "").strip() for k, v in raw_row.items()}

        # --- validation callback ---
        if validate_row_fn:
            err_msg = validate_row_fn(row)
            if err_msg:
                error_count += 1
                rows_out.append(
                    _default_row(index, row, "error", err_msg, serialize_row_fn)
                )
                continue

        # --- lookup ---
        existing = lookup_existing_fn(row)

        if existing:
            if dry_run:
                action = "would_update"
                msg = f"Would update {entity_name} #{existing.id}."
                rows_out.append(
                    _default_row(index, row, action, msg, serialize_row_fn, existing)
                )
            else:
                instance = update_fn(existing, row)
                updated_count += 1
                action = "updated"
                msg = f"Updated {entity_name} #{existing.id}."
                rows_out.append(
                    _default_row(index, row, action, msg, serialize_row_fn, instance)
                )
            continue

        # --- create ---
        if dry_run:
            action = "would_create"
            msg = f"Would create new {entity_name}."
            rows_out.append(
                _default_row(index, row, action, msg, serialize_row_fn)
            )
        else:
            instance = create_fn(row)
            created_count += 1
            action = "created"
            msg = f"Created {entity_name}."
            rows_out.append(
                _default_row(index, row, action, msg, serialize_row_fn, instance)
            )

    summary = {
        "entity": entity_name.replace(" ", "_") + "s",
        "mode": "preview" if dry_run else "apply",
        "total_rows": len(rows_out),
        "created_count": created_count,
        "updated_count": updated_count,
        "error_count": error_count,
    }

    return rows_out, summary


def _default_row(index, row, status, message, serialize_row_fn=None, instance=None):
    """Build the per-row result dict, delegating to serialize_row_fn if provided."""
    if serialize_row_fn:
        return serialize_row_fn(instance, status, row, index, message)
    return {"row_number": index, "status": status, "message": message, **row}


class CsvImportError(Exception):
    """Raised when CSV input or headers fail validation.

    Attributes:
        error_payload: Dict ready to be returned as a DRF Response body.
    """

    def __init__(self, *, code: str, message: str, fields: dict):
        self.error_payload = {
            "error": {"code": code, "message": message, "fields": fields}
        }
        super().__init__(message)
