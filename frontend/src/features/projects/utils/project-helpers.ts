/**
 * Pure helpers for the projects feature.
 *
 * Extracted from `projects-console.tsx` so the logic can be
 * unit-tested independently of React rendering.
 */

import type { ProjectRecord } from "../types";

/** All possible project status values, in display order. */
export const PROJECT_STATUS_VALUES = [
  "prospect",
  "active",
  "on_hold",
  "completed",
  "cancelled",
] as const;

export type ProjectStatusValue = (typeof PROJECT_STATUS_VALUES)[number];

/** Default status filters applied on page load. */
export const DEFAULT_PROJECT_STATUS_FILTERS: ProjectStatusValue[] = ["active", "prospect"];

/** Valid status transitions for each project status. Terminal states have no transitions. */
export const PROJECT_STATUS_TRANSITIONS: Record<ProjectStatusValue, ProjectStatusValue[]> = {
  prospect: ["active", "cancelled"],
  active: ["on_hold", "completed", "cancelled"],
  on_hold: ["active", "completed", "cancelled"],
  completed: [],
  cancelled: [],
};

/**
 * Coerce an unknown value to a numeric dollar amount.
 *
 * Handles raw numbers, decimal strings, and formatted currency strings
 * (strips `$`, `,`, and other non-numeric characters). Returns 0 for
 * unparseable or non-finite input.
 */
export function parseMoneyValue(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value !== "string") {
    return 0;
  }
  const normalized = value.replace(/[^0-9.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Returns the display name for a project's customer, falling back to "Customer #id". */
export function formatCustomerName(project: ProjectRecord): string {
  return project.customer_display_name || `Customer #${project.customer}`;
}

/** Converts a snake_case status value to a human-readable label (e.g. "on_hold" → "on hold"). */
export function projectStatusLabel(statusValue: string): string {
  return statusValue.replace("_", " ");
}

/**
 * Build the list of statuses allowed in the profile editor for a given project.
 *
 * Returns the current status plus any valid transitions, deduplicated.
 */
export function allowedProfileStatuses(currentStatus: ProjectStatusValue): ProjectStatusValue[] {
  const transitions = PROJECT_STATUS_TRANSITIONS[currentStatus] ?? [];
  return [currentStatus, ...transitions].filter(
    (value, index, source) => source.indexOf(value) === index,
  );
}
