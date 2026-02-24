"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { useQuickAddAuthStatus } from "./use-quick-add-auth-status";
import { useQuickAddBusinessWorkflow } from "./use-quick-add-business-workflow";
import {
  QuickAddControllerApi,
  UseQuickAddControllerArgs,
  LeadFieldErrors,
  SubmitIntent,
  DuplicateResolution,
} from "./quick-add-controller.types";

export type {
  QuickAddControllerApi,
  UseQuickAddControllerArgs,
  LeadFieldErrors,
  SubmitIntent,
  DuplicateResolution,
};

export function useQuickAddController({ token, baseAuthMessage }: UseQuickAddControllerArgs) {
  const fullNameRef = useRef<HTMLInputElement>(null);
  const normalizedBaseUrl = useMemo(() => normalizeApiBaseUrl(defaultApiBaseUrl), []);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [projectAddress, setProjectAddress] = useState("");
  const [initialContractValue, setInitialContractValue] = useState("");
  const [notes, setNotes] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectStatus, setProjectStatus] = useState("prospect");
  const [fieldErrors, setFieldErrors] = useState<LeadFieldErrors>({});

  useEffect(() => {
    fullNameRef.current?.focus();
  }, []);

  const authMessage = useQuickAddAuthStatus({
    token,
    baseAuthMessage,
    normalizedBaseUrl,
  });

  const workflow = useQuickAddBusinessWorkflow({
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
  });

  // Explicit parent API object consumed by the composition owner and child components.
  const controllerApi: QuickAddControllerApi = {
    fullNameRef,
    authMessage,
    leadMessage: workflow.leadMessage,
    leadMessageTone: workflow.leadMessageTone,
    conversionMessage: workflow.conversionMessage,
    conversionMessageTone: workflow.conversionMessageTone,
    lastSubmissionIntent: workflow.lastSubmissionIntent,
    lastDuplicateResolution: workflow.lastDuplicateResolution,
    lastConvertedCustomerId: workflow.lastConvertedCustomerId,
    lastConvertedProjectId: workflow.lastConvertedProjectId,
    fullName,
    setFullName,
    phone,
    setPhone,
    projectAddress,
    setProjectAddress,
    initialContractValue,
    setInitialContractValue,
    notes,
    setNotes,
    projectName,
    setProjectName,
    projectStatus,
    setProjectStatus,
    fieldErrors,
    duplicateCandidates: workflow.duplicateCandidates,
    duplicateMatchPayload: workflow.duplicateMatchPayload,
    duplicateResolutionIntent: workflow.duplicateResolutionIntent,
    selectedDuplicateId: workflow.selectedDuplicateId,
    setSelectedDuplicateId: workflow.setSelectedDuplicateId,
    lastLead: workflow.lastLead,
    handleQuickAdd: workflow.handleQuickAdd,
    resolveDuplicate: workflow.resolveDuplicate,
  };

  return controllerApi;
}
