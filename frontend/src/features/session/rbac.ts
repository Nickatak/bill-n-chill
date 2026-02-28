import type { SessionRole } from "./client-session";

/** Check whether the current user's role is among the allowed roles. */
export function hasAnyRole(role: SessionRole | undefined, allowedRoles: SessionRole[]): boolean {
  if (!role) {
    return false;
  }
  return allowedRoles.includes(role);
}
