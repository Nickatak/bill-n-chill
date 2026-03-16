/**
 * Split an address string into individual trimmed display lines,
 * discarding any blank entries.
 *
 * Accepts nullable input for convenience at call sites that resolve
 * optional API fields.
 */
export function toAddressLines(value?: string | null): string[] {
  const trimmed = (value || "").trim();
  if (!trimmed) {
    return [];
  }
  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
