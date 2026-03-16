/** Merge class-name fragments, filtering out falsy values. */
export function joinClassNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
