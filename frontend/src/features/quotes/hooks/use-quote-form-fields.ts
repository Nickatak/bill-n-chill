/**
 * Quote form field state for the composer panel.
 *
 * Owns the editable fields that populate the quote draft composer:
 * title, dates, tax, terms, family collision prompts, and
 * title lock state. Provides hydrate/reset callbacks so the console can
 * load an existing quote into the form or clear it for a new draft.
 *
 * Consumer: QuotesConsole (composed alongside useLineItems and data loading).
 *
 * ## State
 *
 * - quoteTitle           — draft title (text input)
 * - quoteDate            — ISO date string for the quote creation date
 * - validThrough            — ISO date string for validity expiration
 * - termsText               — terms & conditions text block
 * - taxPercent              — tax rate as string (e.g. "8.25")
 * - familyCollisionPrompt   — prompt data when title matches an existing family
 * - confirmedFamilyTitleKey — normalized title key user confirmed for family add
 * - titleLocked             — true when form was populated via duplicate (title read-only)
 * - isSubmitting            — form submission in-flight guard
 *
 * ## Functions
 *
 * - hydrateFromQuote(quote)
 *     Populates all form fields from an QuoteRecord. Used when
 *     selecting an existing quote in the viewer panel.
 *
 * - populateCreateFromQuote(quote)
 *     Pre-fills the create form from an existing quote for "Duplicate
 *     as New". Title is locked so the new quote joins the same family.
 *
 * - resetFormFields()
 *     Clears all form fields to blank-draft defaults, respecting
 *     organization defaults for terms and validity window.
 *
 * - handleQuoteTitleChange(value)
 *     Updates title and clears stale collision prompts when the title
 *     diverges from a previously prompted family.
 *
 * ## Effect
 *
 * - Seeds quoteDate and validThrough on first render (when both are empty).
 *   Uses organization defaults for the validity delta.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  formatDateInputFromIso,
  todayDateInput,
  addDaysToDateInput,
} from "@/shared/date-format";
import {
  mapQuoteLineItemsToInputs,
  normalizeFamilyTitle,
  resolveQuoteValidationDeltaDays,
} from "../helpers";
import type { QuoteLineInput, QuoteRecord } from "../types";
import type { OrganizationDocumentDefaults } from "../components/quote-sheet-v2";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QuoteFamilyCollisionPrompt = {
  title: string;
  latestQuoteId: number | null;
  latestVersion: number | null;
  familySize: number | null;
};

type UseQuoteFormFieldsOptions = {
  organizationDefaults: OrganizationDocumentDefaults | null;
  selectedQuoteIdRef: React.RefObject<string>;
  setLineItems: (items: QuoteLineInput[] | ((prev: QuoteLineInput[]) => QuoteLineInput[])) => void;
  setNextLineId: (id: number | ((prev: number) => number)) => void;
  resetLines: () => void;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manage quote composer form fields: title, dates, tax, terms, sort,
 * collision prompts, and title lock state.
 *
 * @param options - Organization defaults and line-item setters from useLineItems.
 * @returns Form field state, setters, hydrate/reset callbacks, and the submit guard ref.
 */
export function useQuoteFormFields({
  organizationDefaults,
  selectedQuoteIdRef,
  setLineItems,
  setNextLineId,
  resetLines,
}: UseQuoteFormFieldsOptions) {

  // --- State ---

  const [quoteTitle, setQuoteTitle] = useState("");
  const [quoteDate, setQuoteDate] = useState("");
  const [validThrough, setValidThrough] = useState("");
  const [termsText, setTermsText] = useState("");
  const [notesText, setNotesText] = useState("");
  const [taxPercent, setTaxPercent] = useState("0");
  const [contingencyPercent, setContingencyPercent] = useState("0");
  const [overheadProfitPercent, setOverheadProfitPercent] = useState("0");
  const [insurancePercent, setInsurancePercent] = useState("0");
  const [familyCollisionPrompt, setFamilyCollisionPrompt] =
    useState<QuoteFamilyCollisionPrompt | null>(null);
  const [confirmedFamilyTitleKey, setConfirmedFamilyTitleKey] = useState("");
  const [titleLocked, setTitleLocked] = useState(false);
  const [duplicateHint, setDuplicateHint] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitGuard = useRef(false);

  // --- Functions ---

  /** Populate all form fields from an existing quote record. */
  const hydrateFromQuote = useCallback((quote: QuoteRecord) => {
    const quoteTerms = (quote.terms_text || "").trim();
    setQuoteTitle(quote.title || "Untitled");
    setTermsText(quoteTerms || organizationDefaults?.quote_terms_and_conditions || "");
    setNotesText(quote.notes_text || "");
    setTaxPercent(String(quote.tax_percent ?? "0"));
    setContingencyPercent(String(quote.contingency_percent ?? "0"));
    setOverheadProfitPercent(String(quote.overhead_profit_percent ?? "0"));
    setInsurancePercent(String(quote.insurance_percent ?? "0"));
    setValidThrough(quote.valid_through ?? "");
    const mapped = mapQuoteLineItemsToInputs(quote.line_items ?? []);
    setLineItems(mapped);
    setNextLineId(mapped.length + 1);
    const createdDate = formatDateInputFromIso(quote.created_at);
    if (createdDate) {
      setQuoteDate(createdDate);
    }
  }, [organizationDefaults?.quote_terms_and_conditions, setLineItems, setNextLineId]);

  /**
   * Pre-fill the create form from an existing quote (duplicate-as-new).
   *
   * Always starts a new family with an editable title and "(Copy)" suffix.
   * Use "New Revision" (via the viewer panel) to add a version to the
   * same family instead.
   */
  const populateCreateFromQuote = useCallback((quote: QuoteRecord) => {
    const quoteTerms = (quote.terms_text || "").trim();
    setQuoteTitle(`${quote.title || "Untitled"} (Copy)`);
    setTitleLocked(false);
    setDuplicateHint("This will start a new quote family — change the title to distinguish it.");
    setTermsText(quoteTerms || organizationDefaults?.quote_terms_and_conditions || "");
    setNotesText(quote.notes_text || "");
    setTaxPercent(String(quote.tax_percent ?? "0"));
    setContingencyPercent(String(quote.contingency_percent ?? "0"));
    setOverheadProfitPercent(String(quote.overhead_profit_percent ?? "0"));
    setInsurancePercent(String(quote.insurance_percent ?? "0"));
    setValidThrough(quote.valid_through ?? "");
    const mapped = mapQuoteLineItemsToInputs(quote.line_items ?? []);
    setLineItems(mapped);
    setNextLineId(mapped.length + 1);
    const nextQuoteDate = todayDateInput();
    setQuoteDate(nextQuoteDate);
    setFamilyCollisionPrompt(null);
    setConfirmedFamilyTitleKey("");
  }, [organizationDefaults?.quote_terms_and_conditions, setLineItems, setNextLineId]);

  /** Reset all form fields to blank-draft defaults. */
  const resetFormFields = useCallback(() => {
    const nextQuoteDate = todayDateInput();
    const nextValidThrough = addDaysToDateInput(
      nextQuoteDate,
      resolveQuoteValidationDeltaDays(organizationDefaults),
    );
    setQuoteTitle("");
    setTitleLocked(false);
    setDuplicateHint("");
    setFamilyCollisionPrompt(null);
    setConfirmedFamilyTitleKey("");
    setTermsText(organizationDefaults?.quote_terms_and_conditions || "");
    setNotesText("");
    setTaxPercent("0");
    setContingencyPercent("0");
    setOverheadProfitPercent("0");
    setInsurancePercent("0");
    resetLines();
    setQuoteDate(nextQuoteDate);
    setValidThrough(nextValidThrough);
  }, [organizationDefaults, resetLines]);

  /** Update the title and clear stale family-collision prompts when the title diverges. */
  function handleQuoteTitleChange(value: string) {
    setQuoteTitle(value);
    if (duplicateHint) setDuplicateHint("");
    const nextKey = normalizeFamilyTitle(value);
    if (confirmedFamilyTitleKey && confirmedFamilyTitleKey !== nextKey) {
      setConfirmedFamilyTitleKey("");
    }
    if (familyCollisionPrompt && normalizeFamilyTitle(familyCollisionPrompt.title) !== nextKey) {
      setFamilyCollisionPrompt(null);
    }
  }

  // --- Effects ---

  /** Seed the quote date and valid-through defaults on first render. */
  useEffect(() => {
    if (quoteDate) {
      return;
    }
    const nextQuoteDate = todayDateInput();
    setQuoteDate(nextQuoteDate);
    if (!selectedQuoteIdRef.current && !validThrough) {
      setValidThrough(
        addDaysToDateInput(
          nextQuoteDate,
          resolveQuoteValidationDeltaDays(organizationDefaults),
        ),
      );
    }
  }, [quoteDate, organizationDefaults, validThrough]);

  // --- Return bag ---

  return {
    // State
    quoteTitle,
    quoteDate,
    validThrough,
    termsText,
    notesText,
    taxPercent,
    contingencyPercent,
    overheadProfitPercent,
    insurancePercent,
    familyCollisionPrompt,
    confirmedFamilyTitleKey,
    titleLocked,
    duplicateHint,
    isSubmitting,
    submitGuard,

    // Setters
    setQuoteTitle,
    setQuoteDate,
    setValidThrough,
    setTermsText,
    setNotesText,
    setTaxPercent,
    setContingencyPercent,
    setOverheadProfitPercent,
    setInsurancePercent,
    setFamilyCollisionPrompt,
    setConfirmedFamilyTitleKey,
    setTitleLocked,
    setIsSubmitting,

    // Helpers
    hydrateFromQuote,
    populateCreateFromQuote,
    resetFormFields,
    handleQuoteTitleChange,
  };
}
