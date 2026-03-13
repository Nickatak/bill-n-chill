#!/usr/bin/env python3
"""Generate structural index of the bill_n_chill codebase for AI consumption.

Produces markdown files in index/ that summarize every module's public surface:
  - File path and module docstring
  - Class/function/type signatures
  - One-line behavioral descriptions (from docstrings or names)
  - Key intra-project imports

No source code is included — just enough to know what exists and where to look.

Usage:
    python generate_index.py                    # default: ~/bill_n_chill
    python generate_index.py /path/to/repo      # custom repo root
"""

import ast
import os
import re
import sys
from pathlib import Path

REPO_ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "bill_n_chill"
OUTPUT_DIR = REPO_ROOT / "docs" / "ai-index"
BACKEND_ROOT = REPO_ROOT / "backend" / "core"
FRONTEND_ROOT = REPO_ROOT / "frontend" / "src"


# ---------------------------------------------------------------------------
# Python / Backend Parser (uses ast)
# ---------------------------------------------------------------------------

def _first_line(docstring: str | None) -> str:
    """Extract first sentence from a docstring."""
    if not docstring:
        return ""
    line = docstring.strip().split("\n")[0].strip()
    # Trim to first sentence if it contains a period followed by space
    if ". " in line:
        line = line[: line.index(". ") + 1]
    return line


def _format_args(node: ast.FunctionDef) -> str:
    """Format function arguments into a compact signature."""
    args = node.args
    parts = []
    # Positional args (skip 'self', 'cls', 'request')
    skip = {"self", "cls", "request"}
    for arg in args.args:
        name = arg.arg
        if name in skip:
            continue
        annotation = ""
        if arg.annotation:
            annotation = ": " + ast.unparse(arg.annotation)
        parts.append(f"{name}{annotation}")
    # Keyword-only args
    for arg in args.kwonlyargs:
        name = arg.arg
        annotation = ""
        if arg.annotation:
            annotation = ": " + ast.unparse(arg.annotation)
        parts.append(f"{name}{annotation}")
    return ", ".join(parts)


def _extract_decorators(node: ast.FunctionDef | ast.ClassDef) -> list[str]:
    """Extract decorator names."""
    decorators = []
    for dec in node.decorator_list:
        if isinstance(dec, ast.Name):
            decorators.append(dec.id)
        elif isinstance(dec, ast.Call):
            if isinstance(dec.func, ast.Name):
                # e.g., @api_view(["GET"])
                arg_str = ", ".join(ast.unparse(a) for a in dec.args)
                decorators.append(f"{dec.func.id}({arg_str})")
            elif isinstance(dec.func, ast.Attribute):
                decorators.append(dec.func.attr)
        elif isinstance(dec, ast.Attribute):
            decorators.append(dec.attr)
    return decorators


def parse_python_file(filepath: Path) -> dict | None:
    """Parse a Python file and extract its structural index."""
    try:
        source = filepath.read_text()
        tree = ast.parse(source)
    except (SyntaxError, UnicodeDecodeError):
        return None

    module_doc = _first_line(ast.get_docstring(tree))

    # Collect intra-project imports
    project_imports = []
    for node in ast.iter_child_nodes(tree):
        if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("core."):
            names = [alias.name for alias in node.names]
            project_imports.append(f"from {node.module} import {', '.join(names)}")

    # Collect top-level classes and functions
    classes = []
    functions = []

    for node in ast.iter_child_nodes(tree):
        if isinstance(node, ast.ClassDef):
            cls_info = {
                "name": node.name,
                "doc": _first_line(ast.get_docstring(node)),
                "bases": [ast.unparse(b) for b in node.bases],
                "decorators": _extract_decorators(node),
                "methods": [],
                "inner_classes": [],
            }
            for item in node.body:
                if isinstance(item, ast.FunctionDef):
                    if item.name.startswith("__") and item.name != "__str__":
                        continue
                    method_info = {
                        "name": item.name,
                        "args": _format_args(item),
                        "doc": _first_line(ast.get_docstring(item)),
                        "decorators": _extract_decorators(item),
                    }
                    cls_info["methods"].append(method_info)
                elif isinstance(item, ast.ClassDef):
                    # Inner class like Status(TextChoices)
                    inner_doc = _first_line(ast.get_docstring(item))
                    inner_bases = [ast.unparse(b) for b in item.bases]
                    # For TextChoices, extract the values
                    values = []
                    for inner_item in item.body:
                        if isinstance(inner_item, ast.Assign):
                            for target in inner_item.targets:
                                if isinstance(target, ast.Name):
                                    values.append(target.id)
                    cls_info["inner_classes"].append({
                        "name": item.name,
                        "bases": inner_bases,
                        "doc": inner_doc,
                        "values": values,
                    })
            classes.append(cls_info)

        elif isinstance(node, ast.FunctionDef):
            func_info = {
                "name": node.name,
                "args": _format_args(node),
                "doc": _first_line(ast.get_docstring(node)),
                "decorators": _extract_decorators(node),
            }
            functions.append(func_info)

    if not classes and not functions:
        return None

    return {
        "module_doc": module_doc,
        "project_imports": project_imports,
        "classes": classes,
        "functions": functions,
    }


def render_python_entry(rel_path: str, info: dict) -> str:
    """Render a single Python file's index entry as markdown."""
    lines = []
    lines.append(f"### `{rel_path}`")
    if info["module_doc"]:
        lines.append(f"_{info['module_doc']}_")
    lines.append("")

    if info["project_imports"]:
        lines.append("**Depends on:**")
        for imp in info["project_imports"]:
            lines.append(f"- `{imp}`")
        lines.append("")

    for cls in info["classes"]:
        bases = f"({', '.join(cls['bases'])})" if cls["bases"] else ""
        decs = " ".join(f"`@{d}`" for d in cls["decorators"])
        if decs:
            decs = " " + decs
        lines.append(f"**class {cls['name']}{bases}**{decs}")
        if cls["doc"]:
            lines.append(f"> {cls['doc']}")

        for inner in cls["inner_classes"]:
            vals = ", ".join(inner["values"][:8])
            if len(inner["values"]) > 8:
                vals += ", ..."
            inner_bases = f"({', '.join(inner['bases'])})" if inner["bases"] else ""
            lines.append(f"- _class_ `{inner['name']}{inner_bases}` — {vals}")

        for method in cls["methods"]:
            decs = ""
            if method["decorators"]:
                decs = " " + " ".join(f"`@{d}`" for d in method["decorators"])
            doc = f" — {method['doc']}" if method["doc"] else ""
            lines.append(f"- `{method['name']}({method['args']})`{decs}{doc}")

        lines.append("")

    for func in info["functions"]:
        decs = ""
        if func["decorators"]:
            decs = " " + " ".join(f"`@{d}`" for d in func["decorators"])
        doc = f" — {func['doc']}" if func["doc"] else ""
        lines.append(f"- `{func['name']}({func['args']})`{decs}{doc}")

    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# TypeScript / Frontend Parser (regex-based)
# ---------------------------------------------------------------------------

# Patterns for exported symbols
RE_EXPORT_FUNCTION = re.compile(
    r"^export\s+(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)",
    re.MULTILINE,
)
RE_EXPORT_CONST_FUNC = re.compile(
    r"^export\s+const\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?\(?",
    re.MULTILINE,
)
RE_EXPORT_CONST = re.compile(
    r"^export\s+const\s+(\w+)\s*(?::\s*([^=]+))?\s*=",
    re.MULTILINE,
)
RE_EXPORT_TYPE = re.compile(
    r"^export\s+type\s+(\w+)\s*(?:<[^>]*>)?\s*=\s*\{",
    re.MULTILINE,
)
RE_EXPORT_INTERFACE = re.compile(
    r"^export\s+interface\s+(\w+)\s*(?:<[^>]*>)?\s*\{",
    re.MULTILINE,
)
RE_EXPORT_DEFAULT = re.compile(
    r"^export\s+default\s+(?:async\s+)?(?:function\s+)?(\w+)",
    re.MULTILINE,
)
RE_REEXPORT = re.compile(
    r'^export\s+\{([^}]+)\}\s+from\s+"([^"]+)"',
    re.MULTILINE,
)
RE_REEXPORT_STAR = re.compile(
    r'^export\s+\*\s+from\s+"([^"]+)"',
    re.MULTILINE,
)
# JSDoc immediately preceding an export
RE_JSDOC = re.compile(
    r"/\*\*\s*\n\s*\*\s*([^\n]+)",
)

# Type fields inside exported types
RE_TYPE_FIELD = re.compile(r"^\s+(\w+)\??:\s*(.+);", re.MULTILINE)

# React component detection (returns JSX)
RE_JSX_RETURN = re.compile(r"return\s*\(?\s*<")

# Project imports
RE_PROJECT_IMPORT = re.compile(
    r'^import\s+.*from\s+"(@/[^"]+)"',
    re.MULTILINE,
)


def _get_jsdoc_before(source: str, match_start: int) -> str:
    """Find JSDoc comment immediately before a match position."""
    # Look backwards from match_start for */ ending
    chunk = source[max(0, match_start - 500):match_start].rstrip()
    if chunk.endswith("*/"):
        doc_start = chunk.rfind("/**")
        if doc_start != -1:
            doc_block = chunk[doc_start:]
            # Extract first line of doc
            m = RE_JSDOC.search(doc_block)
            if m:
                line = m.group(1).strip()
                if line.endswith("*/"):
                    line = line[:-2].strip()
                return line
    return ""


def parse_ts_file(filepath: Path) -> dict | None:
    """Parse a TypeScript/TSX file and extract its structural index."""
    try:
        source = filepath.read_text()
    except UnicodeDecodeError:
        return None

    # Module doc (first JSDoc or first line comment)
    module_doc = ""
    m = RE_JSDOC.match(source)
    if m:
        module_doc = m.group(1).strip()
        if module_doc.endswith("*/"):
            module_doc = module_doc[:-2].strip()

    # Project imports
    project_imports = sorted(set(RE_PROJECT_IMPORT.findall(source)))

    # Exported functions
    functions = []
    for m in RE_EXPORT_FUNCTION.finditer(source):
        name = m.group(1)
        raw_params = m.group(2).strip()
        # Simplify params — detect destructured objects, extract top-level names
        if not raw_params or raw_params.startswith("{") or raw_params.startswith("\n"):
            params_display = "{...}" if raw_params else ""
        else:
            param_names = []
            for p in raw_params.split(","):
                p = p.strip()
                if not p:
                    continue
                if p.startswith("{"):
                    param_names.append("{...}")
                    break
                param_names.append(p.split(":")[0].split("?")[0].strip())
            params_display = ", ".join(param_names)
        doc = _get_jsdoc_before(source, m.start())
        is_component = bool(RE_JSX_RETURN.search(source[m.start():m.start() + 2000]))
        functions.append({
            "name": name,
            "params": params_display,
            "doc": doc,
            "is_component": is_component,
        })

    # Exported types
    types = []
    for m in RE_EXPORT_TYPE.finditer(source):
        name = m.group(1)
        # Extract field names from the type body
        brace_count = 1
        pos = m.end()
        while pos < len(source) and brace_count > 0:
            if source[pos] == "{":
                brace_count += 1
            elif source[pos] == "}":
                brace_count -= 1
            pos += 1
        type_body = source[m.end():pos - 1]
        # Only top-level fields (not nested)
        fields = []
        for fm in RE_TYPE_FIELD.finditer(type_body):
            # Skip if indented more than one level (nested)
            line_start = type_body.rfind("\n", 0, fm.start()) + 1
            indent = len(type_body[line_start:fm.start()])
            if indent <= 4:
                field_name = fm.group(1)
                fields.append(field_name)
        doc = _get_jsdoc_before(source, m.start())
        types.append({"name": name, "fields": fields, "doc": doc})

    # Exported interfaces
    for m in RE_EXPORT_INTERFACE.finditer(source):
        name = m.group(1)
        doc = _get_jsdoc_before(source, m.start())
        types.append({"name": name, "fields": [], "doc": doc})

    # Re-exports
    reexports = []
    for m in RE_REEXPORT.finditer(source):
        names = [n.strip().split(" as ")[-1] for n in m.group(1).split(",")]
        source_module = m.group(2)
        # Skip type re-exports for brevity unless they're from project modules
        if source_module.startswith("@/") or source_module.startswith("./") or source_module.startswith("../"):
            reexports.append({"names": names, "from": source_module})
    for m in RE_REEXPORT_STAR.finditer(source):
        source_module = m.group(1)
        reexports.append({"names": ["*"], "from": source_module})

    # Export default
    default_export = None
    m = RE_EXPORT_DEFAULT.search(source)
    if m:
        default_export = m.group(1)

    if not functions and not types and not reexports and not default_export:
        return None

    return {
        "module_doc": module_doc,
        "project_imports": project_imports,
        "functions": functions,
        "types": types,
        "reexports": reexports,
        "default_export": default_export,
    }


def render_ts_entry(rel_path: str, info: dict) -> str:
    """Render a single TS/TSX file's index entry as markdown."""
    lines = []
    lines.append(f"### `{rel_path}`")
    if info["module_doc"]:
        lines.append(f"_{info['module_doc']}_")
    lines.append("")

    if info["project_imports"]:
        lines.append("**Depends on:**")
        for imp in info["project_imports"]:
            lines.append(f"- `{imp}`")
        lines.append("")

    for func in info["functions"]:
        kind = "Component" if func["is_component"] else "fn"
        doc = f" — {func['doc']}" if func["doc"] else ""
        # Cap param display to avoid noise
        params = func["params"]
        if len(params) > 60:
            params = "{...}"
        lines.append(f"- [{kind}] `{func['name']}({params})`{doc}")

    for typ in info["types"]:
        fields_str = ""
        if typ["fields"]:
            preview = ", ".join(typ["fields"][:6])
            if len(typ["fields"]) > 6:
                preview += ", ..."
            fields_str = f" {{ {preview} }}"
        doc = f" — {typ['doc']}" if typ["doc"] else ""
        lines.append(f"- [type] `{typ['name']}`{fields_str}{doc}")

    for reexp in info["reexports"]:
        names = ", ".join(reexp["names"])
        lines.append(f"- [re-export] `{names}` from `{reexp['from']}`")

    if info["default_export"]:
        lines.append(f"- [default] `{info['default_export']}`")

    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# File collection and grouping
# ---------------------------------------------------------------------------

def collect_python_files() -> list[Path]:
    """Collect backend Python files, excluding tests, migrations, __init__."""
    files = []
    for root, dirs, filenames in os.walk(BACKEND_ROOT):
        # Skip directories
        dirs[:] = [d for d in dirs if d not in ("__pycache__", "migrations")]
        for f in filenames:
            if f.endswith(".py") and f != "__init__.py":
                files.append(Path(root) / f)
    return sorted(files)


def collect_ts_files() -> list[Path]:
    """Collect frontend TS/TSX files, excluding tests and node_modules."""
    files = []
    for root, dirs, filenames in os.walk(FRONTEND_ROOT):
        dirs[:] = [d for d in dirs if d not in ("node_modules", ".next", "__tests__")]
        for f in filenames:
            if f.endswith((".ts", ".tsx")) and not f.endswith(".test.ts") and not f.endswith(".test.tsx"):
                files.append(Path(root) / f)
    return sorted(files)


def _section_key_python(filepath: Path) -> str:
    """Group Python files by their domain area."""
    rel = filepath.relative_to(BACKEND_ROOT)
    parts = rel.parts
    if parts[0] == "views":
        if len(parts) > 2:
            return f"Views — {parts[1].replace('_', ' ').title()}"
        return "Views — Shared"
    if parts[0] == "models":
        if len(parts) > 2:
            return f"Models — {parts[1].replace('_', ' ').title()}"
        return "Models — Core"
    if parts[0] == "serializers":
        return "Serializers"
    if parts[0] == "policies":
        return "Policies"
    if parts[0] == "utils":
        return "Utils"
    if parts[0] == "tests":
        return "Tests"
    if parts[0] == "management":
        return "Management Commands"
    return "Core"


def _section_key_ts(filepath: Path) -> str:
    """Group TS files by their feature/shared area."""
    rel = filepath.relative_to(FRONTEND_ROOT)
    parts = rel.parts
    if parts[0] == "features":
        return f"Features — {parts[1].replace('-', ' ').title()}"
    if parts[0] == "shared":
        if len(parts) > 1:
            # Directories get their own section; standalone .ts files group as "Utilities"
            child = parts[1]
            if "." in child:
                # It's a file, not a directory
                return "Shared — Utilities"
            return f"Shared — {child.replace('-', ' ').title()}"
        return "Shared — Utilities"
    if parts[0] == "app":
        return "App Routes"
    return "Other"


# ---------------------------------------------------------------------------
# Main generation
# ---------------------------------------------------------------------------

def generate_backend_index():
    files = collect_python_files()
    sections: dict[str, list[str]] = {}

    for filepath in files:
        info = parse_python_file(filepath)
        if not info:
            continue
        rel = str(filepath.relative_to(REPO_ROOT))
        section = _section_key_python(filepath)
        entry = render_python_entry(rel, info)
        sections.setdefault(section, []).append(entry)

    # Build output
    lines = [
        "# Backend Structural Index",
        "",
        f"_Auto-generated from `{REPO_ROOT}/backend/core/`. Do not edit manually._",
        f"_Regenerate: `python generate_index.py`_",
        "",
    ]

    # TOC
    lines.append("## Sections")
    for section in sections:
        anchor = section.lower().replace(" ", "-").replace("—", "").replace("  ", "-").strip("-")
        lines.append(f"- [{section}](#{anchor})")
    lines.append("")

    # Ordered section output
    section_order = [
        "Models — Shared Operations",
        "Models — Estimating",
        "Models — Change Orders",
        "Models — Accounts Receivable",
        "Models — Accounts Payable",
        "Models — Cash Management",
        "Models — Financial Auditing",
        "Models — Core",
        "Serializers",
        "Policies",
        "Views — Shared",
        "Views — Shared Operations",
        "Views — Estimating",
        "Views — Change Orders",
        "Views — Accounts Receivable",
        "Views — Accounts Payable",
        "Views — Cash Management",
        "Utils",
        "Core",
        "Management Commands",
        "Tests",
    ]
    # Add any sections not in the order
    for section in sections:
        if section not in section_order:
            section_order.append(section)

    for section in section_order:
        if section not in sections:
            continue
        lines.append(f"## {section}")
        lines.append("")
        for entry in sections[section]:
            lines.append(entry)

    return "\n".join(lines)


def generate_frontend_index():
    files = collect_ts_files()
    sections: dict[str, list[str]] = {}

    for filepath in files:
        info = parse_ts_file(filepath)
        if not info:
            continue
        rel = str(filepath.relative_to(REPO_ROOT))
        section = _section_key_ts(filepath)
        entry = render_ts_entry(rel, info)
        sections.setdefault(section, []).append(entry)

    lines = [
        "# Frontend Structural Index",
        "",
        f"_Auto-generated from `{REPO_ROOT}/frontend/src/`. Do not edit manually._",
        f"_Regenerate: `python generate_index.py`_",
        "",
    ]

    # TOC
    lines.append("## Sections")
    for section in sections:
        anchor = section.lower().replace(" ", "-").replace("—", "").replace("  ", "-").strip("-")
        lines.append(f"- [{section}](#{anchor})")
    lines.append("")

    # Ordered section output
    section_order = [
        "App Routes",
        "Features — Estimates",
        "Features — Change Orders",
        "Features — Invoices",
        "Features — Vendor Bills",
        "Features — Payments",
        "Features — Projects",
        "Features — Customers",
        "Features — Vendors",
        "Features — Cost Codes",
        "Features — Organization",
        "Features — Dashboard",
        "Features — Onboarding",
        "Features — Financials Auditing",
        "Shared — Api",
        "Shared — Session",
        "Shared — Shell",
        "Shared — Hooks",
        "Shared — Document Creator",
        "Shared — Document Viewer",
        "Shared — Types",
        "Shared — Onboarding",
        "Shared — Project List Viewer",
        "Shared — Utilities",
        "Shared — Components",
    ]
    for section in sections:
        if section not in section_order:
            section_order.append(section)

    for section in section_order:
        if section not in sections:
            continue
        lines.append(f"## {section}")
        lines.append("")
        for entry in sections[section]:
            lines.append(entry)

    return "\n".join(lines)


def main():
    OUTPUT_DIR.mkdir(exist_ok=True)

    print("Generating backend index...")
    backend = generate_backend_index()
    (OUTPUT_DIR / "backend.md").write_text(backend)
    backend_lines = backend.count("\n")
    rel_out = OUTPUT_DIR.relative_to(REPO_ROOT)
    print(f"  -> {rel_out}/backend.md ({backend_lines} lines)")

    print("Generating frontend index...")
    frontend = generate_frontend_index()
    (OUTPUT_DIR / "frontend.md").write_text(frontend)
    frontend_lines = frontend.count("\n")
    print(f"  -> {rel_out}/frontend.md ({frontend_lines} lines)")

    print("Done.")


if __name__ == "__main__":
    main()
