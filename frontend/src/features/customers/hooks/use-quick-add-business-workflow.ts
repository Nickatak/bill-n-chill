/**
 * Business-workflow hook for the quick-add customer intake form.
 *
 * Encapsulates the submit-validate-respond cycle including duplicate
 * detection and resolution. The controller hook owns field state; this hook
 * owns submission orchestration, API calls, and the feedback messages that
 * result from them.
 */

"use client";

import { FormEvent, RefObject, useState } from "react";

import { postQuickAddCustomerIntake } from "../api";
import {
  IntakeApiResponse,
  CustomerIntakeRecord,
  CustomerIntakePayload,
  DuplicateData,
  DuplicateCustomerCandidate,
  QuickAddResult,
} from "../types";
import {
  DuplicateResolution,
  LeadFieldErrors,
  PendingSubmission,
  QuickAddMessageTone,
  SubmitIntent,
} from "./quick-add-controller.types";
import { validateLeadFields } from "./quick-add-validation";

type UseQuickAddBusinessWorkflowArgs = {
  token: string;
  normalizedBaseUrl: string;
  fullNameRef: RefObject<HTMLInputElement | null>;
  fullName: string;
  phone: string;
  projectAddress: string;
  initialContractValue: string;
  notes: string;
  projectName: string;
  projectStatus: string;
  setFullName: (value: string) => void;
  setPhone: (value: string) => void;
  setProjectAddress: (value: string) => void;
  setInitialContractValue: (value: string) => void;
  setNotes: (value: string) => void;
  setFieldErrors: (errors: LeadFieldErrors) => void;
};

/**
 * Manage the full submission lifecycle for the quick-add form.
 *
 * Handles three flows:
 *  1. Normal create (customer only, or customer + project)
 *  2. Duplicate detected — parks the submission and exposes candidates
 *  3. Duplicate resolved — replays the parked submission with a resolution
 *
 * Returns reactive state for messages, duplicate UI, and last-success data
 * so the controller can surface them to the form.
 */
export function useQuickAddBusinessWorkflow({
  token,
  normalizedBaseUrl,
  fullNameRef,
  fullName,
  phone,
  projectAddress,
  initialContractValue,
  notes,
  projectName,
  projectStatus,
  setFullName,
  setPhone,
  setProjectAddress,
  setInitialContractValue,
  setNotes,
  setFieldErrors,
}: UseQuickAddBusinessWorkflowArgs) {
  // --- User-facing feedback messages ---

  const [leadMessage, setLeadMessage] = useState("");
  const [leadMessageTone, setLeadMessageTone] = useState<QuickAddMessageTone>("neutral");
  const [conversionMessage, setConversionMessage] = useState("");
  const [conversionMessageTone, setConversionMessageTone] = useState<QuickAddMessageTone>("neutral");

  // --- Duplicate-detection state ---

  const [duplicateCandidates, setDuplicateCandidates] = useState<DuplicateCustomerCandidate[]>([]);
  const [selectedDuplicateId, setSelectedDuplicateId] = useState<string>("");
  const [pendingSubmission, setPendingSubmission] = useState<PendingSubmission | null>(null);

  // --- Last-success state (shown in the confirmation banner) ---

  const [lastLead, setLastLead] = useState<CustomerIntakeRecord | null>(null);
  const [lastSubmissionIntent, setLastSubmissionIntent] = useState<SubmitIntent | null>(null);
  const [lastDuplicateResolution, setLastDuplicateResolution] = useState("none");
  const [lastConvertedCustomerId, setLastConvertedCustomerId] = useState<number | null>(null);
  const [lastConvertedCustomerName, setLastConvertedCustomerName] = useState("");
  const [lastConvertedProjectId, setLastConvertedProjectId] = useState<number | null>(null);
  const [lastConvertedProjectName, setLastConvertedProjectName] = useState("");

  /**
   * Reset all "last successful submission" state so a new submission starts
   * with a clean slate and does not flash stale confirmation data.
   */
  function clearLastSuccessState() {
    setLastLead(null);
    setLastSubmissionIntent(null);
    setLastDuplicateResolution("none");
    setLastConvertedCustomerId(null);
    setLastConvertedCustomerName("");
    setLastConvertedProjectId(null);
    setLastConvertedProjectName("");
  }

  /**
   * Send the intake payload to the API and handle every possible outcome:
   * duplicate conflict (409), other errors, or success.
   *
   * On success, updates confirmation state and resets the form for the next
   * entry. On failure, preserves the entered values so the user can fix and
   * retry without re-typing.
   */
  async function submitQuickAdd(
    body: CustomerIntakePayload,
    submission: PendingSubmission,
    options?: { duplicate_resolution?: string; duplicate_target_id?: number },
  ) {
    const response = await postQuickAddCustomerIntake({
      baseUrl: normalizedBaseUrl,
      token,
      body: {
        ...body,
        create_project: submission.intent === "customer_and_project",
        project_name: submission.projectName,
        project_status: submission.projectStatus,
        ...options,
      },
    });
    const payload: IntakeApiResponse = await response.json();

    // --- Duplicate conflict — park the submission and show candidates ---

    if (response.status === 409 && payload.error?.code === "duplicate_detected") {
      const data = payload.data as DuplicateData;
      const candidates = data.duplicate_candidates ?? [];
      setDuplicateCandidates(candidates);
      setSelectedDuplicateId(candidates[0] ? String(candidates[0].id) : "");
      setPendingSubmission(submission);
      setLeadMessage("");
      setLeadMessageTone("neutral");
      return;
    }

    // --- Other API errors ---

    if (!response.ok) {
      setLeadMessage(payload.error?.message ?? "Quick Add failed. Check token and required fields.");
      setLeadMessageTone("error");
      return;
    }

    // --- Success path — extract results and update confirmation state ---

    const result = payload.data as QuickAddResult;
    const resolution = payload.meta?.duplicate_resolution ?? "none";
    const lead = result.customer_intake;
    const customerId = typeof result.customer?.id === "number" ? result.customer.id : null;
    const customerName = typeof result.customer?.display_name === "string" ? result.customer.display_name : "";
    const projectId = typeof result.project?.id === "number" ? result.project.id : null;
    const projectNameFromResult =
      typeof result.project?.name === "string" ? result.project.name : "";

    setLeadMessage("");
    setDuplicateCandidates([]);
    setSelectedDuplicateId("");
    setPendingSubmission(null);

    setLastLead(lead);
    setLastSubmissionIntent(submission.intent);
    setLastDuplicateResolution(resolution);
    setLastConvertedCustomerId(customerId);
    setLastConvertedCustomerName(customerName);
    setLastConvertedProjectId(projectId);
    setLastConvertedProjectName(projectNameFromResult);
    setConversionMessage("");
    setConversionMessageTone("neutral");

    // Determine the user-facing success or partial-failure message.
    if (submission.intent === "customer_and_project") {
      if (customerId !== null && projectId !== null) {
        setLeadMessage("Customer + project created.");
        setLeadMessageTone("success");
      } else {
        setLeadMessage("Customer was captured, but project creation did not complete.");
        setLeadMessageTone("error");
      }
    } else {
      if (customerId !== null) {
        setLeadMessage("Customer created.");
        setLeadMessageTone("success");
      } else {
        setLeadMessage("Intake record saved, but customer creation did not complete.");
        setLeadMessageTone("error");
      }
    }

    const saveSucceeded =
      customerId !== null && (submission.intent === "customer_only" || projectId !== null);

    if (!saveSucceeded) {
      setConversionMessage(
        submission.intent === "customer_and_project"
          ? "Check project-required fields and try again."
          : "Check required fields and try again.",
      );
      setConversionMessageTone("error");
    }

    // Keep entered values when persistence failed so the user can adjust and retry.
    if (saveSucceeded) {
      setFullName("");
      setPhone("");
      setProjectAddress("");
      setInitialContractValue("");
      setNotes("");
      setFieldErrors({});
      fullNameRef.current?.focus();
    }
  }

  /**
   * Form submit handler — validates fields, builds the payload, and kicks
   * off the API submission. The submitter button's value determines whether
   * this is a "customer only" or "customer + project" intent.
   */
  async function handleQuickAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Determine intent from the submitter button value (the form has two
    // submit buttons with different values).
    const nativeEvent = event.nativeEvent as SubmitEvent;
    const submitter = nativeEvent.submitter as HTMLButtonElement | null;
    const submitterValue = submitter?.value ?? "customer_and_project";
    const intent: SubmitIntent =
      submitterValue === "customer_only" ? "customer_only" : "customer_and_project";

    clearLastSuccessState();
    setLeadMessage("");
    setLeadMessageTone("neutral");
    setConversionMessage("");
    setConversionMessageTone("neutral");

    if (!token) {
      setLeadMessage("No shared session token found. Go to / and sign in.");
      setLeadMessageTone("error");
      return;
    }

    const payload: CustomerIntakePayload = {
      full_name: fullName.trim(),
      phone: phone.trim(),
      project_address: projectAddress.trim(),
      email: "",
      initial_contract_value: initialContractValue.trim() ? initialContractValue.trim() : null,
      notes: notes.trim(),
      source: "field_manual",
    };

    const submission: PendingSubmission = {
      payload,
      intent,
      projectName: projectName.trim() || `${fullName.trim()} Project`,
      projectStatus,
    };

    const nextErrors = validateLeadFields(payload, { intent, projectName });
    setFieldErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      setLeadMessage("Fix the required fields and submit again.");
      setLeadMessageTone("error");
      return;
    }

    try {
      await submitQuickAdd(payload, submission);
    } catch {
      setLeadMessage("Quick add failed due to an unexpected UI error.");
      setLeadMessageTone("error");
    }
  }

  /**
   * Resolve a previously detected duplicate by replaying the parked
   * submission with the chosen resolution strategy.
   *
   * Supports "create_anyway" (ignore the duplicate) or merge/link
   * strategies that require a target customer ID.
   */
  async function resolveDuplicate(resolution: DuplicateResolution, targetId?: number) {
    if (!pendingSubmission) {
      setLeadMessage("No pending duplicate payload to resolve.");
      setLeadMessageTone("error");
      return;
    }

    try {
      const resolvedTargetId = targetId ?? Number(selectedDuplicateId);
      if (!resolvedTargetId) {
        setLeadMessage("Select a duplicate candidate first.");
        setLeadMessageTone("error");
        return;
      }

      await submitQuickAdd(pendingSubmission.payload, pendingSubmission, {
        duplicate_resolution: resolution,
        duplicate_target_id: resolvedTargetId,
      });
    } catch {
      setLeadMessage("Could not resolve duplicate at this time.");
      setLeadMessageTone("error");
    }
  }

  return {
    leadMessage,
    leadMessageTone,
    conversionMessage,
    conversionMessageTone,

    lastSubmissionIntent,
    lastDuplicateResolution,
    lastConvertedCustomerId,
    lastConvertedCustomerName,
    lastConvertedProjectId,
    lastConvertedProjectName,

    duplicateCandidates,
    duplicateMatchPayload: pendingSubmission?.payload ?? null,
    duplicateResolutionIntent: pendingSubmission?.intent ?? null,
    selectedDuplicateId,
    setSelectedDuplicateId,

    lastLead,
    handleQuickAdd,
    resolveDuplicate,
  };
}
