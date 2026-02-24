"use client";

import { FormEvent, RefObject, useState } from "react";

import { postConvertLeadToProject, postQuickAddLead } from "../api";
import {
  ApiResponse,
  DuplicateData,
  LeadContactCandidate,
  LeadConvertResult,
  LeadPayload,
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
  const [leadMessage, setLeadMessage] = useState("");
  const [leadMessageTone, setLeadMessageTone] = useState<QuickAddMessageTone>("neutral");
  const [conversionMessage, setConversionMessage] = useState("");
  const [conversionMessageTone, setConversionMessageTone] = useState<QuickAddMessageTone>("neutral");

  const [duplicateCandidates, setDuplicateCandidates] = useState<LeadContactCandidate[]>([]);
  const [selectedDuplicateId, setSelectedDuplicateId] = useState<string>("");
  const [pendingSubmission, setPendingSubmission] = useState<PendingSubmission | null>(null);

  const [lastLead, setLastLead] = useState<LeadContactCandidate | null>(null);
  const [lastSubmissionIntent, setLastSubmissionIntent] = useState<SubmitIntent | null>(null);
  const [lastDuplicateResolution, setLastDuplicateResolution] = useState("none");
  const [lastConvertedCustomerId, setLastConvertedCustomerId] = useState<number | null>(null);
  const [lastConvertedProjectId, setLastConvertedProjectId] = useState<number | null>(null);

  function clearLastSuccessState() {
    setLastLead(null);
    setLastSubmissionIntent(null);
    setLastDuplicateResolution("none");
    setLastConvertedCustomerId(null);
    setLastConvertedProjectId(null);
  }

  async function convertLeadToProject(leadId: number, name: string, status: string): Promise<{
    ok: boolean;
    customerId: number | null;
    projectId: number | null;
  }> {
    setConversionMessage("Converting lead to customer + project...");
    setConversionMessageTone("info");

    const response = await postConvertLeadToProject({
      baseUrl: normalizedBaseUrl,
      token,
      leadId,
      projectName: name,
      projectStatus: status,
    });

    const payload: ApiResponse = await response.json();
    if (!response.ok) {
      setConversionMessage(payload.error?.message ?? "Lead conversion failed.");
      setConversionMessageTone("error");
      return { ok: false, customerId: null, projectId: null };
    }

    const result = payload.data as LeadConvertResult;
    const resultStatus = payload.meta?.conversion_status ?? "converted";
    const customerId = typeof result.customer?.id === "number" ? result.customer.id : null;
    const projectId = typeof result.project?.id === "number" ? result.project.id : null;
    const successStatus = resultStatus === "converted" || resultStatus === "already_converted";

    if (successStatus) {
      setConversionMessage("");
      setConversionMessageTone("neutral");
      return { ok: true, customerId, projectId };
    }

    setConversionMessage(
      `Conversion status: ${resultStatus.replaceAll("_", " ")}.`,
    );
    setConversionMessageTone("info");
    return { ok: true, customerId, projectId };
  }

  async function submitQuickAdd(
    body: LeadPayload,
    submission: PendingSubmission,
    options?: { duplicate_resolution?: string; duplicate_target_id?: number },
  ) {
    const response = await postQuickAddLead({
      baseUrl: normalizedBaseUrl,
      token,
      body: {
        ...body,
        ...options,
      },
    });
    const payload: ApiResponse = await response.json();

    if (response.status === 409 && payload.error?.code === "duplicate_detected") {
      const data = payload.data as DuplicateData;
      const candidates = data.duplicate_candidates ?? [];
      setDuplicateCandidates(candidates);
      setSelectedDuplicateId(candidates[0] ? String(candidates[0].id) : "");
      setPendingSubmission(submission);
      setLeadMessage("Possible duplicate found. Choose a resolution below.");
      setLeadMessageTone("info");
      return;
    }

    if (!response.ok) {
      setLeadMessage(payload.error?.message ?? "Quick Add failed. Check token and required fields.");
      setLeadMessageTone("error");
      return;
    }

    const result = payload.data as LeadContactCandidate;
    const resolution = payload.meta?.duplicate_resolution ?? "none";
    setLeadMessage("");
    setDuplicateCandidates([]);
    setSelectedDuplicateId("");
    setPendingSubmission(null);
    setLastLead(result);
    setLastSubmissionIntent(submission.intent);
    setLastDuplicateResolution(resolution);

    let conversionSucceeded = true;
    if (submission.intent === "contact_and_project") {
      const outcome = await convertLeadToProject(
        result.id,
        submission.projectName,
        submission.projectStatus,
      );
      setLastConvertedCustomerId(outcome.customerId);
      setLastConvertedProjectId(outcome.projectId);
      conversionSucceeded = outcome.ok;
      if (outcome.ok) {
        setLeadMessage("Contact + project created.");
        setLeadMessageTone("success");
      } else {
        setLeadMessage("Contact saved, but project conversion failed.");
        setLeadMessageTone("error");
      }
    } else {
      setConversionMessage("");
      setConversionMessageTone("neutral");
      setLastConvertedCustomerId(null);
      setLastConvertedProjectId(null);
      setLeadMessage("Contact created.");
      setLeadMessageTone("success");
    }

    // Keep entered values when contact was created but conversion failed so the user can adjust and retry.
    if (conversionSucceeded) {
      setFullName("");
      setPhone("");
      setProjectAddress("");
      setInitialContractValue("");
      setNotes("");
      setFieldErrors({});
      fullNameRef.current?.focus();
    }
  }

  async function handleQuickAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nativeEvent = event.nativeEvent as SubmitEvent;
    const submitter = nativeEvent.submitter as HTMLButtonElement | null;
    const submitterValue = submitter?.value ?? "contact_and_project";
    const intent: SubmitIntent =
      submitterValue === "contact_only" ? "contact_only" : "contact_and_project";

    clearLastSuccessState();
    setLeadMessage(
      intent === "contact_only" ? "Submitting lead contact..." : "Creating contact + project...",
    );
    setLeadMessageTone("info");
    setConversionMessage("");
    setConversionMessageTone("neutral");

    if (!token) {
      setLeadMessage("No shared session token found. Go to / and sign in.");
      setLeadMessageTone("error");
      return;
    }

    const payload: LeadPayload = {
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
      setLeadMessage("Lead submission failed due to an unexpected UI error.");
      setLeadMessageTone("error");
    }
  }

  async function resolveDuplicate(resolution: DuplicateResolution, targetId?: number) {
    if (!pendingSubmission) {
      setLeadMessage("No pending duplicate payload to resolve.");
      setLeadMessageTone("error");
      return;
    }

    try {
      if (resolution === "create_anyway") {
        await submitQuickAdd(pendingSubmission.payload, pendingSubmission, {
          duplicate_resolution: resolution,
        });
        return;
      }

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
    lastConvertedProjectId,
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
