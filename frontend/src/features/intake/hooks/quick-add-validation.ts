import { LeadPayload } from "../types";
import { LeadFieldErrors, SubmitIntent } from "./quick-add-controller.types";

export function validateLeadFields(
  payload: LeadPayload,
  {
    intent,
    projectName,
  }: {
    intent: SubmitIntent;
    projectName: string;
  },
): LeadFieldErrors {
  const nextErrors: LeadFieldErrors = {};
  const contactValue = payload.phone.trim();

  if (!payload.full_name.trim()) {
    nextErrors.full_name = "Full name is required.";
  }

  if (!contactValue) {
    nextErrors.phone = "Provide a valid phone number or email address.";
  } else {
    const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactValue);
    const digits = contactValue.replace(/\D/g, "");
    const looksLikePhone =
      /^[0-9+\-().\s]+$/.test(contactValue) && digits.length >= 7 && digits.length <= 15;
    if (!looksLikeEmail && !looksLikePhone) {
      nextErrors.phone = "Entry must be a valid phone number or email address.";
    }
  }

  if (!payload.project_address.trim()) {
    nextErrors.project_address = "Project address is required.";
  }
  if (intent === "contact_and_project" && !projectName.trim()) {
    nextErrors.project_name = "Project name is required when creating project + customer.";
  }

  return nextErrors;
}
