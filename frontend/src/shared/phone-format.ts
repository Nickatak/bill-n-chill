/**
 * Format a phone number string for display.
 *
 * - 10-digit US numbers → (555) 123-4567
 * - 11-digit with leading 1 → (555) 123-4567
 * - Anything else → returned as-is
 */
export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "");

  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  if (digits.length === 11 && digits[0] === "1") {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  return value;
}
