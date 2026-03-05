# Deferred Validation Notes

## Context

Quick Add now supports "phone OR email" as minimum contact method.

## Deferred Issue

Phone values are currently treated as free-form text. This means malformed/low-quality phone entries can still be accepted as long as at least one contact method exists.

Email validation is stronger due to email field semantics, but phone validation is intentionally deferred for now.

## Planned Follow-Up

1. Add backend phone normalization + validation rule (digit threshold, clear errors).
2. Add matching frontend inline validation for faster feedback.
3. Reconcile duplicate detection behavior with normalized phone storage/compare strategy.
4. Add tests for malformed phone rejection and normalized accepted formats.

## Why Deferred

Priority shifted to continued feature development and flow shaping before tightening this validation policy.
