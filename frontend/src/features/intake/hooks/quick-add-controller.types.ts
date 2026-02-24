import { FormEvent, RefObject } from "react";

import {
  CustomerIntakePayload,
  CustomerIntakeRecord,
  DuplicateCustomerCandidate,
} from "../types";

export type LeadFieldErrors = {
  full_name?: string;
  phone?: string;
  project_address?: string;
  project_name?: string;
};

export type SubmitIntent = "customer_only" | "customer_and_project";
export type QuickAddMessageTone = "neutral" | "info" | "success" | "error";

export type DuplicateResolution = "use_existing" | "create_anyway";

export type PendingSubmission = {
  payload: CustomerIntakePayload;
  intent: SubmitIntent;
  projectName: string;
  projectStatus: string;
};

export type UseQuickAddControllerArgs = {
  token: string;
  baseAuthMessage: string;
};

export type QuickAddControllerApi = {
  fullNameRef: RefObject<HTMLInputElement | null>;
  authMessage: string;
  leadMessage: string;
  leadMessageTone: QuickAddMessageTone;
  conversionMessage: string;
  conversionMessageTone: QuickAddMessageTone;
  lastSubmissionIntent: SubmitIntent | null;
  lastDuplicateResolution: string;
  lastConvertedCustomerId: number | null;
  lastConvertedCustomerName: string;
  lastConvertedProjectId: number | null;
  lastConvertedProjectName: string;
  fullName: string;
  setFullName: (value: string) => void;
  phone: string;
  setPhone: (value: string) => void;
  projectAddress: string;
  setProjectAddress: (value: string) => void;
  initialContractValue: string;
  setInitialContractValue: (value: string) => void;
  notes: string;
  setNotes: (value: string) => void;
  projectName: string;
  setProjectName: (value: string) => void;
  projectStatus: string;
  setProjectStatus: (value: string) => void;
  fieldErrors: LeadFieldErrors;
  duplicateCandidates: DuplicateCustomerCandidate[];
  duplicateMatchPayload: CustomerIntakePayload | null;
  duplicateResolutionIntent: SubmitIntent | null;
  selectedDuplicateId: string;
  setSelectedDuplicateId: (value: string) => void;
  lastLead: CustomerIntakeRecord | null;
  handleQuickAdd: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  resolveDuplicate: (resolution: DuplicateResolution, targetId?: number) => Promise<void>;
};
