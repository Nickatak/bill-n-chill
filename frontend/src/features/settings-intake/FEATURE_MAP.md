# Feature Map: Intake Settings

## Purpose
Configure local intake guardrails for operations workflows until server-side policy settings are introduced.

## Route Surface
1. `/settings/intake`

## Mutation Map
1. `IntakeSettings`
   - create/update local browser settings (`localStorage` key: `bnc-intake-settings-v1`)

## Composition and Entry Flow
1. Entry sources:
   - direct route entry: `frontend/src/app/settings/intake/page.tsx` mounts `IntakeSettingsConsole`
   - feature export entry: `frontend/src/features/settings-intake/index.ts` exports `IntakeSettingsConsole`
2. Parent/Owner:
   `IntakeSettingsConsole` owns settings form composition and status rendering.
3. Controller/Hook:
   `useIntakeSettingsController` returns explicit parent API object `IntakeSettingsControllerApi`.
4. Children:
   none (single-console feature)
5. Default behavior:
   loads local settings from storage and renders toggle controls.
6. Overrides:
   missing/invalid local storage payload falls back to default setting values.
7. Relationship flow:
   route mount -> controller loads local settings -> user toggles/saves -> local storage mutation -> status message update.

## API Surface Used
1. none:
   local-only feature using browser storage.

## Backend Contracts Used
- Contract endpoint(s): none
- Consumed fields: none
- Behavior source: local controller logic in `frontend/src/features/settings-intake/hooks/use-intake-settings-controller.ts`
- Fallback policy: n/a (no contract adapter in this feature)

## State Model (Remote, Local, Derived)
- State buckets:
  - Remote Data:
    - none
  - Local UI State:
    - settings toggles
    - save status message
  - Derived State:
    - storage fallback defaults when key is missing/invalid

## Error and Empty States
- Error states:
  - local storage write failure
- Empty states:
  - no previously persisted settings (defaults loaded)

## Test Anchors
- Existing anchors:
  - none
- TODO:
  - add controller tests for load/save/fallback behavior
  - add console rendering tests for toggle interactions and messaging
