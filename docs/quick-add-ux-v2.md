# Quick Add Contact UX v2

## Purpose

Optimize intake for field speed while improving confidence and recovery when data quality or session issues occur.

## Design Goals

1. Speed lane first: capture a lead in under 60 seconds.
2. Confidence lane second: clearly resolve duplicates and continue to project conversion.
3. Recovery-first feedback: explicit next-step guidance after success/failure.

## Information Architecture

### 1) Lead Capture (Primary)

Required fields (always visible):
- Full name
- Project address
- Contact method: phone or email

Optional fields (collapsed by default):
- Email
- Source
- Notes

Primary CTA:
- `Create Contact Only`
- `Create Contact + Project` (requires project name)

### 2) Duplicate Resolution (Conditional)

When duplicate candidates are detected:
- Show candidate selector
- Provide explicit actions:
  - Use Existing
  - Merge into Existing
  - Create Anyway

### 3) Conversion (Secondary)

After lead creation:
- Prefill lead ID
- Offer immediate conversion to customer + project
- Provide post-conversion path to Projects

## Interaction Rules

- Auto-verify shared session on page load.
- Show inline field errors for required lead inputs.
- Use mobile-friendly input modes (`tel`) for phone capture.
- Keep one primary action in lead capture; secondary actions appear only when relevant.
- After successful lead create, show a concise summary with next-step CTA.

## Acceptance Checks

- Required-only lead capture works with optional details collapsed.
- Inline validation prevents empty required submissions.
- Duplicate detection flow remains functional.
- Created lead summary appears with clear next action.
- Conversion flow remains functional and reports result status.
