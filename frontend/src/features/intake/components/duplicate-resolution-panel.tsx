"use client";

import { KeyboardEvent } from "react";

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

function formatCreatedAt(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function normalized(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

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
  const resolveActionLabel = isProjectFlow
    ? "Create Project for This Customer"
    : "Use This Customer";
  const createAnywayLabel = isProjectFlow
    ? "Create New Customer + Project Instead"
    : "Create New Customer Instead";
  const helperText = isProjectFlow
    ? "Use an existing customer for this project, or continue by creating a new customer and project."
    : "Use an existing customer, or continue by creating a new one.";

  return (
    <section className={styles.duplicatePanel} aria-label="Duplicate resolution">
      <div className={styles.duplicateHeader}>
        <h3 className={styles.duplicateTitle}>Potential Matches Found</h3>
        <span className={styles.duplicateCount}>
          {duplicateCandidates.length} possible {duplicateCandidates.length === 1 ? "match" : "matches"}
        </span>
      </div>
      <p className={styles.duplicateHint}>{helperText}</p>
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

          return (
            <article
              key={candidate.id}
              className={`${styles.duplicateCard} ${isSelected ? styles.duplicateCardSelected : ""}`}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              onClick={selectCandidate}
              onKeyDown={onCardKeyDown}
            >
              <div className={styles.duplicateCardTopRow}>
                <span className={styles.duplicateCardTitleWrap}>
                  <span className={styles.duplicateCardTitle}>
                    #{candidate.id} {candidate.display_name}
                  </span>
                </span>
                <button
                  type="button"
                  className={styles.duplicateResolveButton}
                  onClick={(event) => {
                    event.stopPropagation();
                    onResolve("use_existing", candidate.id);
                  }}
                >
                  {resolveActionLabel}
                </button>
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
            </article>
          );
        })}
      </div>
      <button
        type="button"
        className={styles.duplicateCreateAnywayButton}
        onClick={() => onResolve("create_anyway")}
      >
        {createAnywayLabel}
      </button>
    </section>
  );
}
