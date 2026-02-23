"use client";

import Link from "next/link";

import { useSharedSessionAuth } from "../../session/use-shared-session";
import { DuplicateResolutionPanel } from "./duplicate-resolution-panel";
import { QuickAddForm } from "./quick-add-form";
import { useQuickAddController } from "../hooks/use-quick-add-controller";
import styles from "./quick-add-console.module.css";

export function QuickAddConsole() {
  // Composition owner: bridges shared-session auth into the controller before child workflows run.
  const { token, authMessage: baseAuthMessage } = useSharedSessionAuth();
  const controllerApi = useQuickAddController({ token, baseAuthMessage });

  return (
    <section className={styles.section}>
      <h2>Intake: Quick Add</h2>
      <p>
        This route gives field and office users a fast way to capture a qualified lead with
        duplicate detection and explicit resolution before bad data spreads.
      </p>
      <p>
        It is the workflow entry point: successful conversion here creates the Customer + Project
        shell used by every downstream route in the financial loop.
      </p>
      <p>Use one form for both capture-only and capture-with-project actions.</p>
      <p>{controllerApi.authMessage}</p>

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
      />

      <DuplicateResolutionPanel
        duplicateCandidates={controllerApi.duplicateCandidates}
        selectedDuplicateId={controllerApi.selectedDuplicateId}
        onSelectDuplicateId={controllerApi.setSelectedDuplicateId}
        onResolve={controllerApi.resolveDuplicate}
      />

      <p>{controllerApi.leadMessage}</p>

      {controllerApi.lastLead ? (
        <div className={styles.summaryCard}>
          <p className={styles.summaryTitle}>Lead created</p>
          <p className={styles.summaryText}>
            #{controllerApi.lastLead.id} - {controllerApi.lastLead.full_name} (
            {controllerApi.lastLead.phone || controllerApi.lastLead.email})
          </p>
        </div>
      ) : null}

      <p>{controllerApi.conversionMessage}</p>
      {controllerApi.conversionMessage.includes("customer #") ? (
        <div className={styles.inlineActions}>
          <Link className={styles.secondaryLink} href="/projects">
            Go to Projects
          </Link>
        </div>
      ) : null}
    </section>
  );
}
