"use client";

/**
 * Duplicate resolution UI shown during quick-add when existing customer matches are detected.
 *
 * Intent-aware:
 * - customer_and_project: lets user pick an existing customer to attach the project to.
 * - customer_only: shows a link to the existing customer (no creation action needed).
 */

import { KeyboardEvent } from "react";
import Link from "next/link";

import { CustomerIntakePayload, DuplicateCustomerCandidate } from "../types";
import { DuplicateResolution, SubmitIntent } from "../hooks/quick-add-controller.types";
import styles from "./quick-add-console.module.css";

type DuplicateResolutionPanelProps = {
  duplicateCandidates: DuplicateCustomerCandidate[];
  selectedDuplicateId: string;
  duplicateMatchPayload: CustomerIntakePayload | null;
  duplicateResolutionIntent: SubmitIntent | null;
  onSelectDuplicateId: (value: string) => void;
  onResolve: (resolution: DuplicateResolution, targetId?: number) => void;
};

/** Format a created_at timestamp for display in the candidate card. */
function formatCreatedAt(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

/** Normalize a string for case-insensitive field comparison. */
function normalized(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

/** Identify which fields match between a candidate and the submitted intake payload. */
function matchedFields(candidate: DuplicateCustomerCandidate, payload: CustomerIntakePayload | null) {
  if (!payload) {
    return [];
  }

  const matches: string[] = [];
  if (normalized(payload.phone) && normalized(candidate.phone) === normalized(payload.phone)) {
    matches.push("phone");
  }
  if (normalized(payload.email) && normalized(candidate.email) === normalized(payload.email)) {
    matches.push("email");
  }
  if (
    normalized(payload.full_name) &&
    normalized(candidate.display_name) === normalized(payload.full_name)
  ) {
    matches.push("name");
  }
  if (
    normalized(payload.project_address) &&
    normalized(candidate.billing_address) === normalized(payload.project_address)
  ) {
    matches.push("address");
  }

  return matches;
}

/** Renders duplicate candidate cards with match highlighting and resolution actions. */
export function DuplicateResolutionPanel({
  duplicateCandidates,
  selectedDuplicateId,
  duplicateMatchPayload,
  duplicateResolutionIntent,
  onSelectDuplicateId,
  onResolve,
}: DuplicateResolutionPanelProps) {
  if (duplicateCandidates.length === 0) {
    return null;
  }

  const isProjectFlow = duplicateResolutionIntent === "customer_and_project";

  return (
    <section className={styles.duplicatePanel} aria-label="Duplicate resolution">
      <h3 className={styles.duplicateTitle}>Customer already exists</h3>
      <div className={styles.duplicateList}>
        {duplicateCandidates.map((candidate) => {
          const isSelected = selectedDuplicateId === String(candidate.id);
          const matches = matchedFields(candidate, duplicateMatchPayload);
          const matchSet = new Set(matches);
          const candidateId = String(candidate.id);

          function selectCandidate() {
            onSelectDuplicateId(candidateId);
          }

          function onCardKeyDown(event: KeyboardEvent<HTMLElement>) {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              selectCandidate();
            }
          }

          const cardClassName = [
            styles.duplicateCard,
            isProjectFlow ? styles.duplicateCardInteractive : "",
            isSelected ? styles.duplicateCardSelected : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <article
              key={candidate.id}
              className={cardClassName}
              {...(isProjectFlow
                ? {
                    role: "button" as const,
                    tabIndex: 0,
                    "aria-pressed": isSelected,
                    onClick: selectCandidate,
                    onKeyDown: onCardKeyDown,
                  }
                : {})}
            >
              <div className={styles.duplicateCardTopRow}>
                <span className={styles.duplicateCardTitleWrap}>
                  <Link
                    className={styles.duplicateCardTitle}
                    href={`/customers?customer=${candidate.id}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    #{candidate.id} {candidate.display_name}
                  </Link>
                </span>
              </div>
              <div className={styles.duplicateCardSelect}>
                <span
                  className={`${styles.duplicateFieldRow} ${
                    matchSet.has("name") ? styles.duplicateFieldRowMatched : ""
                  }`}
                >
                  <span className={styles.duplicateFieldLabel}>Name</span>
                  <span className={styles.duplicateCardMeta}>{candidate.display_name}</span>
                </span>
                <span
                  className={`${styles.duplicateFieldRow} ${
                    matchSet.has("email") ? styles.duplicateFieldRowMatched : ""
                  }`}
                >
                  <span className={styles.duplicateFieldLabel}>Email</span>
                  <span className={styles.duplicateCardMeta}>
                    {candidate.email || "No email captured"}
                  </span>
                </span>
                <span
                  className={`${styles.duplicateFieldRow} ${
                    matchSet.has("phone") ? styles.duplicateFieldRowMatched : ""
                  }`}
                >
                  <span className={styles.duplicateFieldLabel}>Phone</span>
                  <span className={styles.duplicateCardMeta}>
                    {candidate.phone || "No phone captured"}
                  </span>
                </span>
                <span
                  className={`${styles.duplicateFieldRow} ${
                    matchSet.has("address") ? styles.duplicateFieldRowMatched : ""
                  }`}
                >
                  <span className={styles.duplicateFieldLabel}>Address</span>
                  <span className={styles.duplicateCardMeta}>
                    {candidate.billing_address || "No address captured"}
                  </span>
                </span>
                <span className={styles.duplicateFieldRow}>
                  <span className={styles.duplicateFieldLabel}>Created</span>
                  <span className={styles.duplicateCardMeta}>
                    {formatCreatedAt(candidate.created_at)}
                  </span>
                </span>
              </div>
              {isProjectFlow ? (
                <button
                  type="button"
                  className={styles.duplicateResolveButton}
                  onClick={(event) => {
                    event.stopPropagation();
                    onResolve("use_existing", candidate.id);
                  }}
                >
                  Use Customer + Start Project
                </button>
              ) : (
                <Link
                  className={styles.duplicateViewLink}
                  href={`/customers?customer=${candidate.id}`}
                >
                  View customer &rarr;
                </Link>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
