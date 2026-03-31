/**
 * Shared domain types used across multiple feature modules.
 *
 * Types here represent cross-cutting entities whose shape is
 * identical regardless of which feature consumes them.
 */

/** Organization context included in public document previews. */
export type OrganizationPublicContext = {
  display_name: string;
  logo_url: string;
  billing_address: string;
  help_email: string;
  invoice_terms_and_conditions: string;
  quote_terms_and_conditions: string;
  change_order_terms_and_conditions: string;
};

/** Cost code reference used in line items across quotes, invoices, etc. */
export type CostCode = {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
  taxable: boolean;
};

/** Minimal user identity for auth context in feature consoles. */
export type UserData = {
  token?: string;
  email?: string;
};
