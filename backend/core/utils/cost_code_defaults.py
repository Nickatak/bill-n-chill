"""Default cost-code seed data used for org bootstrap and demo seeding."""

DEFAULT_COST_CODE_POLICY_VERSION = "2026-02-24.cost-codes.default.v1"

# Lean default catalog for small-to-mid residential GC/remodel operations.
DEFAULT_COST_CODE_ROWS: list[tuple[str, str]] = [
    ("01-100", "Project Management & Supervision"),
    ("01-110", "Permits & Inspections"),
    ("01-120", "Temporary Utilities"),
    ("01-130", "Site Protection & Safety"),
    ("01-140", "Cleanup & Dumpster"),
    ("01-150", "Equipment Rental"),
    ("01-170", "Allowances / Owner Selections"),
    ("01-900", "Punchlist / Final Clean / Closeout"),
    ("02-100", "Selective Demolition"),
    ("03-100", "Concrete / Flatwork"),
    ("06-100", "Rough Carpentry / Framing"),
    ("06-200", "Finish Carpentry / Trim"),
    ("06-300", "Cabinets & Millwork"),
    ("07-200", "Waterproofing / Sealants"),
    ("07-300", "Insulation"),
    ("08-100", "Doors & Windows"),
    ("09-100", "Drywall"),
    ("09-200", "Painting"),
    ("09-300", "Flooring"),
    ("09-400", "Tile & Stone"),
    ("10-100", "Specialties (mirrors/accessories)"),
    ("12-100", "Appliances"),
    ("22-100", "Plumbing Rough"),
    ("22-200", "Plumbing Fixtures & Finish"),
    ("23-100", "HVAC Rough"),
    ("23-200", "HVAC Equipment & Finish"),
    ("26-100", "Electrical Rough"),
    ("26-200", "Electrical Fixtures & Finish"),
    ("27-100", "Low Voltage / Data / AV"),
    ("32-100", "Hardscape / Exterior Flatwork"),
]
