"use client";

/**
 * Top-level quick-add console that composes the customer intake workflow.
 * Bridges shared-session auth into the quick-add controller, renders status
 * feedback, and orchestrates the duplicate-resolution and form sub-components.
 *
 * Parent: CustomersConsole
 */

import { useEffect, useRef } from "react";
import Link from "next/link";

import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import { DuplicateResolutionPanel } from "./duplicate-resolution-panel";
import { QuickAddForm } from "./quick-add-form";
import { useQuickAddController } from "../../hooks/use-quick-add-controller";
import styles from "./quick-add-console.module.css";

type QuickAddConsoleProps = {
  onCustomerCreated?: () => void;
  onBrowseCustomer?: (searchTerm: string) => void;
};

/** Orchestrates the quick-add customer workflow, combining auth, form, and duplicate resolution. */
export function QuickAddConsole({ onCustomerCreated, onBrowseCustomer }: QuickAddConsoleProps) {
  // Composition owner: bridges shared-session auth into the controller before child workflows run.
  const { token, authMessage: baseAuthMessage } = useSharedSessionAuth();
  const controllerApi = useQuickAddController({ token, baseAuthMessage, onCustomerCreated });
  const statusMessage = controllerApi.conversionMessage || controllerApi.leadMessage;
  const statusTone = controllerApi.conversionMessage
    ? controllerApi.conversionMessageTone
    : controllerApi.leadMessageTone;
  const statusLiveMode = statusTone === "error" ? "assertive" : "polite";
  const hasCustomerLink = controllerApi.lastConvertedCustomerId !== null;
  const hasProjectLink = controllerApi.lastConvertedProjectId !== null;
  const statusAnchorRef = useRef<HTMLDivElement | null>(null);
  const lastScrollKeyRef = useRef("");

  /** Build status message content with linked entity references on success. */
  function renderStatusMessageContent() {
    if (statusTone !== "success") {
      return statusMessage;
    }

    return (
      <>
        <span>{statusMessage}</span>
        {hasCustomerLink ? (
          <Link
            className={styles.formStatusLink}
            href={`/customers?customer=${controllerApi.lastConvertedCustomerId}`}
          >
            Customer #{controllerApi.lastConvertedCustomerId}
            {controllerApi.lastConvertedCustomerName
              ? ` (${controllerApi.lastConvertedCustomerName})`
              : ""}{" "}
            &rarr;
          </Link>
        ) : null}
        {hasProjectLink ? (
          <Link
            className={styles.formStatusLink}
            href={`/projects?project=${controllerApi.lastConvertedProjectId}`}
          >
            Project #{controllerApi.lastConvertedProjectId}
            {controllerApi.lastConvertedProjectName
              ? ` (${controllerApi.lastConvertedProjectName})`
              : ""}{" "}
            &rarr;
          </Link>
        ) : null}
      </>
    );
  }

  // Scroll to status area when a new message or duplicate panel appears.
  useEffect(() => {
    const duplicateCount = controllerApi.duplicateCandidates.length;
    const nextKey = `${statusMessage}|${duplicateCount}`;
    if (!statusMessage && duplicateCount === 0) {
      return;
    }
    if (nextKey === lastScrollKeyRef.current) {
      return;
    }
    lastScrollKeyRef.current = nextKey;
    statusAnchorRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [controllerApi.duplicateCandidates.length, statusMessage]);

  const statusSlot = statusMessage ? (
    <div
      ref={statusAnchorRef}
      role={statusTone === "error" ? "alert" : "status"}
      aria-live={statusLiveMode}
      className={`${styles.formStatus} ${
        statusTone === "success"
          ? styles.formStatusSuccess
          : statusTone === "error"
            ? styles.formStatusError
            : styles.formStatusInfo
      }`}
    >
      {renderStatusMessageContent()}
    </div>
  ) : <div ref={statusAnchorRef} />;

  return (
    <section className={styles.section}>
      <div className={styles.introCard}>
        <p className={styles.introLead}>
          Add a customer in under a minute, then optionally start a project in the same step.
        </p>
        <p className={styles.introMeta}>
          If we find a possible match, we will ask before creating anything so your customer list stays clean.
        </p>
      </div>
      {controllerApi.authMessage ? <p>{controllerApi.authMessage}</p> : null}

      <DuplicateResolutionPanel
        duplicateCandidates={controllerApi.duplicateCandidates}
        duplicateMatchPayload={controllerApi.duplicateMatchPayload}
        duplicateResolutionIntent={controllerApi.duplicateResolutionIntent}
        selectedDuplicateId={controllerApi.selectedDuplicateId}
        onSelectDuplicateId={controllerApi.setSelectedDuplicateId}
        onResolve={controllerApi.resolveDuplicate}
        onBrowseCustomer={onBrowseCustomer}
      />

      <QuickAddForm
        fullNameRef={controllerApi.fullNameRef}
        fullName={controllerApi.fullName}
        onFullNameChange={controllerApi.setFullName}
        phone={controllerApi.phone}
        onPhoneChange={controllerApi.setPhone}
        projectAddress={controllerApi.projectAddress}
        onProjectAddressChange={controllerApi.setProjectAddress}
        projectName={controllerApi.projectName}
        onProjectNameChange={controllerApi.setProjectName}
        initialContractValue={controllerApi.initialContractValue}
        onInitialContractValueChange={controllerApi.setInitialContractValue}
        projectStatus={controllerApi.projectStatus}
        onProjectStatusChange={controllerApi.setProjectStatus}
        notes={controllerApi.notes}
        onNotesChange={controllerApi.setNotes}
        fieldErrors={controllerApi.fieldErrors}
        onSubmit={controllerApi.handleQuickAdd}
        statusSlot={statusSlot}
      />
    </section>
  );
}
