# Quick Add Customer UX v2

Last reviewed: 2026-02-28

## Purpose

Optimize intake for field speed while improving confidence and recovery when data quality or session issues occur.

## Design Goals

1. Speed lane first: capture a customer in under 60 seconds.
2. Confidence lane second: clearly resolve duplicates and continue to project conversion.
3. Recovery-first feedback: explicit next-step guidance after success/failure.

## Information Architecture

### 1) Customer Capture (Primary)

Required fields (always visible):
- Full name
- Project address
- Phone or email

Optional fields (collapsed by default):
- Email
- Source
- Notes

Primary CTA:
- `Create Customer Only`
- `Create Customer + Project` (requires project name)

### 2) Duplicate Resolution (Conditional)

When duplicate candidates are detected:
- Show candidate selector
- Provide explicit actions:
  - Use Existing
  - Create Anyway

### 3) Project Creation (Secondary)

After customer intake:
- Preserve intake ID for audit traceability
- Offer immediate project creation
- Provide a post-create path to Projects

## Interaction Rules

- Auto-verify shared session on page load.
- Show inline field errors for required intake inputs.
- Use mobile-friendly input modes (`tel`) for phone capture.
- Keep one primary action in customer capture; secondary actions appear only when relevant.
- After successful customer create, show a concise summary with next-step CTA.

## Acceptance Checks

- Required-only customer capture works with optional details collapsed.
- Inline validation prevents empty required submissions.
- Duplicate detection flow remains functional.
- Created customer summary appears with clear next action.
- Project-create flow remains functional and reports result status.
