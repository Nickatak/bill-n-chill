/**
 * Client-side validation for the quick-add customer intake form.
 *
 * Validates lead fields before the payload is sent to the API, providing
 * immediate feedback so obviously invalid submissions never hit the server.
 * The contact field (phone) accepts either a phone number or email address,
 * since field workers often have one but not the other.
 */

import { CustomerIntakePayload } from "../types";
import { LeadFieldErrors, SubmitIntent } from "./quick-add-controller.types";

/**
 * Validate lead-capture fields and return a map of field-level errors.
 *
 * Returns an empty object when all fields pass. The `intent` parameter
 * controls whether project-specific fields (e.g. project name) are
 * required — they are only enforced for "customer_and_project" submissions.
 */
export function validateLeadFields(
  payload: CustomerIntakePayload,
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

  // The contact field accepts either a phone number or an email address,
  // since field crews may only have one form of contact for a lead.
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

  // Project name is only required when the user explicitly chose to create
  // both a customer and a project in a single submission.
  if (intent === "customer_and_project" && !projectName.trim()) {
    nextErrors.project_name = "Project name is required when creating project + customer.";
  }

  return nextErrors;
}
