# Frontend

Next.js App Router frontend for `bill-n-chill`.

## Run

```bash
cd frontend
npm run dev
```

Default URL: `http://localhost:3000`

## Architecture Entry

Primary architecture reference:
- `frontend/ARCHITECTURE_MAP.md`

Feature ownership maps:
- `frontend/src/features/*/FEATURE_MAP.md`
- template: `frontend/src/features/FEATURE_MAP_TEMPLATE.md`

## Conventions

1. Route shim policy
- `src/app/**/page.tsx` files are route/layout shims only.
- Domain/workflow orchestration belongs in `src/features/**`.

2. Parent controller API policy
- Each feature console consumes one `use<Feature>Controller` hook.
- Controller returns one explicit typed `...ControllerApi` object.

3. Function style
- Top-level exported units: `function name(...) {}`
- Local callbacks/closures: `const name = (...) => {}`
