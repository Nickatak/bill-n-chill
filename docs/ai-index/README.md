# AI Structural Index

Machine-readable structural index of the codebase. Designed for AI assistant consumption — lets the AI understand what exists, where it lives, and what it does without reading full source files.

## Files

- **backend.md** — Every Python module in `backend/core/`: models, views, serializers, policies, utils. Includes class hierarchies, method signatures, docstrings, decorators (`@api_view`, `@permission_classes`), inner enums (Status choices with values), and intra-project import chains.
- **frontend.md** — Every TS/TSX module in `frontend/src/`: feature modules, shared libraries, app routes. Includes exported functions/components/types, field previews for type definitions, re-export chains, and project dependency graphs.

## How the AI should use this

1. **Start here, not in the source.** When beginning a task, read the relevant section of the index to locate which files matter. This avoids burning context on large files you don't need.
2. **Use the dependency chains.** Each file lists its `Depends on` imports. Trace these to understand how a change propagates across layers (model -> serializer -> view -> frontend API -> component).
3. **Use signatures to skip irrelevant code.** If you need to modify `estimate_detail_view`, the index tells you it's a `GET/PATCH` endpoint at a specific location with specific helpers. Read only that function, not the entire 892-line view file.
4. **Types tell you the API shape.** Frontend type definitions list field names — use these to understand what the API returns without reading serializer code.

## Regenerating

```bash
python3 scripts/generate_ai_index.py
```

Run this after significant structural changes (new files, renamed functions, new exports). The script uses Python's `ast` module for backend and regex parsing for frontend — runs in ~1 second.

## What's included vs excluded

**Included:** All non-test source files with exported symbols. Backend test files are included because they document behavioral contracts.

**Excluded:** `__init__.py`, migrations, `__pycache__`, frontend test files (`__tests__/`), node_modules, source code bodies. Only signatures and one-line descriptions.
