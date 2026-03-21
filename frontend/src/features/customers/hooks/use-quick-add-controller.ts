/**
 * Top-level controller hook for the quick-add customer intake form.
 *
 * Owns all form field state and composes the auth-status and business-workflow
 * hooks into a single {@link QuickAddControllerApi} object. The page component
 * consumes this API and threads it down to child components — no child ever
 * reaches into the controller's internals directly.
 */

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

/**
 * Initialize and return the full quick-add controller API.
 *
 * Manages form field state (name, phone, address, etc.), derives the auth
 * status message, and delegates submission / duplicate-resolution logic to
 * the business-workflow hook. The returned object is the single source of
 * truth for every quick-add UI component.
 */
export function useQuickAddController({ authToken, baseAuthMessage, onCustomerCreated }: UseQuickAddControllerArgs) {
  const fullNameRef = useRef<HTMLInputElement>(null);
  const normalizedBaseUrl = useMemo(() => normalizeApiBaseUrl(defaultApiBaseUrl), []);

  // --- Form field state ---

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [projectAddress, setProjectAddress] = useState("");
  const [initialContractValue, setInitialContractValue] = useState("");
  const [notes, setNotes] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectStatus, setProjectStatus] = useState("prospect");
  const [fieldErrors, setFieldErrors] = useState<LeadFieldErrors>({});

  // Auto-focus the first field on mount so the user can start typing immediately.
  useEffect(() => {
    fullNameRef.current?.focus();
  }, []);

  // --- Composed hooks ---

  const authMessage = useQuickAddAuthStatus({
    authToken,
    baseAuthMessage,
  });

  const workflow = useQuickAddBusinessWorkflow({
    authToken,
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
    onCustomerCreated,
  });

  // --- Public API surface ---

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
    lastConvertedCustomerName: workflow.lastConvertedCustomerName,
    lastConvertedProjectId: workflow.lastConvertedProjectId,
    lastConvertedProjectName: workflow.lastConvertedProjectName,

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
