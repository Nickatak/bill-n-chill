/**
 * Estimate form field state for the composer panel.
 *
 * Owns the editable fields that populate the estimate draft composer:
 * title, dates, tax, terms, line sort, family collision prompts, and
 * title lock state. Provides hydrate/reset callbacks so the console can
 * load an existing estimate into the form or clear it for a new draft.
 *
 * Consumer: EstimatesConsole (composed alongside useLineItems and data loading).
 *
 * ## State
 *
 * - estimateTitle           — draft title (text input)
 * - estimateDate            — ISO date string for the estimate creation date
 * - validThrough            — ISO date string for validity expiration
 * - termsText               — terms & conditions text block
 * - taxPercent              — tax rate as string (e.g. "8.25")
 * - lineSortKey             — active column sort key (null = manual order)
 * - lineSortDirection       — "asc" | "desc"
 * - familyCollisionPrompt   — prompt data when title matches an existing family
 * - confirmedFamilyTitleKey — normalized title key user confirmed for family add
 * - titleLocked             — true when form was populated via duplicate (title read-only)
 * - isSubmitting            — form submission in-flight guard
 *
 * ## Functions
 *
 * - hydrateFromEstimate(estimate)
 *     Populates all form fields from an EstimateRecord. Used when
 *     selecting an existing estimate in the viewer panel.
 *
 * - populateCreateFromEstimate(estimate)
 *     Pre-fills the create form from an existing estimate for "Duplicate
 *     as New". Title is locked so the new estimate joins the same family.
 *
 * - resetFormFields()
 *     Clears all form fields to blank-draft defaults, respecting
 *     organization defaults for terms and validity window.
 *
 * - handleEstimateTitleChange(value)
 *     Updates title and clears stale collision prompts when the title
 *     diverges from a previously prompted family.
 *
 * ## Effect
 *
 * - Seeds estimateDate and validThrough on first render (when both are empty).
 *   Uses organization defaults for the validity delta.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  formatDateInputFromIso,
  todayDateInput,
  addDaysToDateInput,
} from "@/shared/date-format";
import {
  mapEstimateLineItemsToInputs,
  normalizeFamilyTitle,
  resolveEstimateValidationDeltaDays,
} from "../helpers";
import type { EstimateLineInput, EstimateRecord } from "../types";
import type { OrganizationDocumentDefaults } from "../components/estimate-sheet";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LineSortKey = "quantity" | "costCode" | "unitCost" | "markupPercent" | "amount";

export type EstimateFamilyCollisionPrompt = {
  title: string;
  latestEstimateId: number | null;
  latestVersion: number | null;
  familySize: number | null;
};

type UseEstimateFormFieldsOptions = {
  organizationDefaults: OrganizationDocumentDefaults | null;
  selectedEstimateIdRef: React.RefObject<string>;
  setLineItems: (items: EstimateLineInput[] | ((prev: EstimateLineInput[]) => EstimateLineInput[])) => void;
  setNextLineId: (id: number | ((prev: number) => number)) => void;
  resetLines: () => void;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manage estimate composer form fields: title, dates, tax, terms, sort,
 * collision prompts, and title lock state.
 *
 * @param options - Organization defaults and line-item setters from useLineItems.
 * @returns Form field state, setters, hydrate/reset callbacks, and the submit guard ref.
 */
export function useEstimateFormFields({
  organizationDefaults,
  selectedEstimateIdRef,
  setLineItems,
  setNextLineId,
  resetLines,
}: UseEstimateFormFieldsOptions) {

  // --- State ---

  const [estimateTitle, setEstimateTitle] = useState("");
  const [estimateDate, setEstimateDate] = useState("");
  const [validThrough, setValidThrough] = useState("");
  const [termsText, setTermsText] = useState("");
  const [taxPercent, setTaxPercent] = useState("0");
  const [lineSortKey, setLineSortKey] = useState<LineSortKey | null>(null);
  const [lineSortDirection, setLineSortDirection] = useState<"asc" | "desc">("asc");
  const [familyCollisionPrompt, setFamilyCollisionPrompt] =
    useState<EstimateFamilyCollisionPrompt | null>(null);
  const [confirmedFamilyTitleKey, setConfirmedFamilyTitleKey] = useState("");
  const [titleLocked, setTitleLocked] = useState(false);
  const [duplicateHint, setDuplicateHint] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitGuard = useRef(false);

  // --- Functions ---

  /** Populate all form fields from an existing estimate record. */
  const hydrateFromEstimate = useCallback((estimate: EstimateRecord) => {
    const estimateTerms = (estimate.terms_text || "").trim();
    setEstimateTitle(estimate.title || "Untitled");
    setTermsText(estimateTerms || organizationDefaults?.estimate_terms_and_conditions || "");
    setTaxPercent(String(estimate.tax_percent ?? "0"));
    setValidThrough(estimate.valid_through ?? "");
    const mapped = mapEstimateLineItemsToInputs(estimate.line_items ?? []);
    setLineItems(mapped);
    setNextLineId(mapped.length + 1);
    const createdDate = formatDateInputFromIso(estimate.created_at);
    if (createdDate) {
      setEstimateDate(createdDate);
    }
  }, [organizationDefaults?.estimate_terms_and_conditions, setLineItems, setNextLineId]);

  /**
   * Pre-fill the create form from an existing estimate (duplicate-as-new).
   *
   * When the source family is non-terminal, the title is locked so the new
   * estimate joins the same family. When the source family is terminal
   * (has an approved member), the title gets a "(Copy)" suffix and remains
   * editable so the user starts a new family.
   */
  const populateCreateFromEstimate = useCallback((estimate: EstimateRecord, familyIsTerminal = false) => {
    const estimateTerms = (estimate.terms_text || "").trim();
    if (familyIsTerminal) {
      setEstimateTitle(`${estimate.title || "Untitled"} (Copy)`);
      setTitleLocked(false);
      setDuplicateHint(
        "The original estimate was approved and can\u2019t be revised. "
        + "This will start a new estimate \u2014 give it a distinct title.",
      );
    } else {
      setEstimateTitle(estimate.title || "Untitled");
      setTitleLocked(true);
      setDuplicateHint("");
    }
    setTermsText(estimateTerms || organizationDefaults?.estimate_terms_and_conditions || "");
    setTaxPercent(String(estimate.tax_percent ?? "0"));
    setValidThrough(estimate.valid_through ?? "");
    const mapped = mapEstimateLineItemsToInputs(estimate.line_items ?? []);
    setLineItems(mapped);
    setNextLineId(mapped.length + 1);
    const nextEstimateDate = todayDateInput();
    setEstimateDate(nextEstimateDate);
    setFamilyCollisionPrompt(null);
    setConfirmedFamilyTitleKey("");
  }, [organizationDefaults?.estimate_terms_and_conditions, setLineItems, setNextLineId]);

  /** Reset all form fields to blank-draft defaults. */
  const resetFormFields = useCallback(() => {
    const nextEstimateDate = todayDateInput();
    const nextValidThrough = addDaysToDateInput(
      nextEstimateDate,
      resolveEstimateValidationDeltaDays(organizationDefaults),
    );
    setEstimateTitle("");
    setTitleLocked(false);
    setDuplicateHint("");
    setFamilyCollisionPrompt(null);
    setConfirmedFamilyTitleKey("");
    setTermsText(organizationDefaults?.estimate_terms_and_conditions || "");
    setTaxPercent("0");
    resetLines();
    setLineSortKey(null);
    setLineSortDirection("asc");
    setEstimateDate(nextEstimateDate);
    setValidThrough(nextValidThrough);
  }, [organizationDefaults, resetLines]);

  /** Update the title and clear stale family-collision prompts when the title diverges. */
  function handleEstimateTitleChange(value: string) {
    setEstimateTitle(value);
    const nextKey = normalizeFamilyTitle(value);
    if (confirmedFamilyTitleKey && confirmedFamilyTitleKey !== nextKey) {
      setConfirmedFamilyTitleKey("");
    }
    if (familyCollisionPrompt && normalizeFamilyTitle(familyCollisionPrompt.title) !== nextKey) {
      setFamilyCollisionPrompt(null);
    }
  }

  // --- Effects ---

  /** Seed the estimate date and valid-through defaults on first render. */
  useEffect(() => {
    if (estimateDate) {
      return;
    }
    const nextEstimateDate = todayDateInput();
    setEstimateDate(nextEstimateDate);
    if (!selectedEstimateIdRef.current && !validThrough) {
      setValidThrough(
        addDaysToDateInput(
          nextEstimateDate,
          resolveEstimateValidationDeltaDays(organizationDefaults),
        ),
      );
    }
  }, [estimateDate, organizationDefaults, validThrough]);

  // --- Return bag ---

  return {
    // State
    estimateTitle,
    estimateDate,
    validThrough,
    termsText,
    taxPercent,
    lineSortKey,
    lineSortDirection,
    familyCollisionPrompt,
    confirmedFamilyTitleKey,
    titleLocked,
    duplicateHint,
    isSubmitting,
    submitGuard,

    // Setters
    setEstimateTitle,
    setEstimateDate,
    setValidThrough,
    setTermsText,
    setTaxPercent,
    setLineSortKey,
    setLineSortDirection,
    setFamilyCollisionPrompt,
    setConfirmedFamilyTitleKey,
    setTitleLocked,
    setIsSubmitting,

    // Helpers
    hydrateFromEstimate,
    populateCreateFromEstimate,
    resetFormFields,
    handleEstimateTitleChange,
  };
}
