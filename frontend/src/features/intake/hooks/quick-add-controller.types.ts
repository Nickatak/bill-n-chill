import { FormEvent, RefObject } from "react";

import { LeadContactCandidate, LeadPayload } from "../types";

export type LeadFieldErrors = {
  full_name?: string;
  phone?: string;
  project_address?: string;
  project_name?: string;
};

export type SubmitIntent = "contact_only" | "contact_and_project";

export type DuplicateResolution = "use_existing" | "merge_existing" | "create_anyway";

export type PendingSubmission = {
  payload: LeadPayload;
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
  conversionMessage: string;
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
  duplicateCandidates: LeadContactCandidate[];
  selectedDuplicateId: string;
  setSelectedDuplicateId: (value: string) => void;
  lastLead: LeadContactCandidate | null;
  handleQuickAdd: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  resolveDuplicate: (resolution: DuplicateResolution) => Promise<void>;
};
