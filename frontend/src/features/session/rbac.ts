import type { SessionRole } from "./client-session";

export function hasAnyRole(role: SessionRole | undefined, allowedRoles: SessionRole[]): boolean {
  if (!role) {
    return false;
  }
  return allowedRoles.includes(role);
}
