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
  const [conversionMessage, setConversionMessage] = useState("");

  const [duplicateCandidates, setDuplicateCandidates] = useState<LeadContactCandidate[]>([]);
  const [selectedDuplicateId, setSelectedDuplicateId] = useState<string>("");
  const [pendingSubmission, setPendingSubmission] = useState<PendingSubmission | null>(null);

  const [lastLead, setLastLead] = useState<LeadContactCandidate | null>(null);

  async function convertLeadToProject(leadId: number, name: string, status: string): Promise<boolean> {
    setConversionMessage("Converting lead to customer + project...");

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
      return false;
    }

    const result = payload.data as LeadConvertResult;
    const resultStatus = payload.meta?.conversion_status ?? "converted";
    setConversionMessage(
      `Conversion ${resultStatus}: customer #${result.customer?.id ?? "?"}, project #${result.project?.id ?? "?"}.`,
    );
    return true;
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
      return;
    }

    if (!response.ok) {
      setLeadMessage(payload.error?.message ?? "Quick Add failed. Check token and required fields.");
      return;
    }

    const result = payload.data as LeadContactCandidate;
    const resolution = payload.meta?.duplicate_resolution ?? "none";
    setLeadMessage(`Lead contact saved (#${result.id}) via resolution: ${resolution}.`);
    setDuplicateCandidates([]);
    setSelectedDuplicateId("");
    setPendingSubmission(null);
    setLastLead(result);

    const conversionSucceeded =
      submission.intent === "contact_and_project"
        ? await convertLeadToProject(result.id, submission.projectName, submission.projectStatus)
        : true;
    if (submission.intent !== "contact_and_project") {
      setConversionMessage("");
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
    const intent: SubmitIntent =
      submitter?.value === "contact_and_project" ? "contact_and_project" : "contact_only";

    setLeadMessage(
      intent === "contact_only" ? "Submitting lead contact..." : "Creating contact + project...",
    );

    if (!token) {
      setLeadMessage("No shared session token found. Go to / and sign in.");
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
      return;
    }

    try {
      await submitQuickAdd(payload, submission);
    } catch {
      setLeadMessage("Lead submission failed due to an unexpected UI error.");
    }
  }

  async function resolveDuplicate(resolution: DuplicateResolution) {
    if (!pendingSubmission) {
      setLeadMessage("No pending duplicate payload to resolve.");
      return;
    }

    try {
      if (resolution === "create_anyway") {
        await submitQuickAdd(pendingSubmission.payload, pendingSubmission, {
          duplicate_resolution: resolution,
        });
        return;
      }

      const targetId = Number(selectedDuplicateId);
      if (!targetId) {
        setLeadMessage("Select a duplicate candidate first.");
        return;
      }

      await submitQuickAdd(pendingSubmission.payload, pendingSubmission, {
        duplicate_resolution: resolution,
        duplicate_target_id: targetId,
      });
    } catch {
      setLeadMessage("Could not resolve duplicate at this time.");
    }
  }

  return {
    leadMessage,
    conversionMessage,
    duplicateCandidates,
    selectedDuplicateId,
    setSelectedDuplicateId,
    lastLead,
    handleQuickAdd,
    resolveDuplicate,
  };
}
