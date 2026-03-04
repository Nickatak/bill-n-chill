import type { Capabilities, SessionRole } from "./client-session";

/** Check whether the current user's role is among the allowed roles. */
export function hasAnyRole(role: SessionRole | undefined, allowedRoles: SessionRole[]): boolean {
  if (!role) {
    return false;
  }
  return allowedRoles.includes(role);
}

/** Check whether the user's capabilities include a specific resource action. */
export function canDo(
  capabilities: Capabilities | undefined,
  resource: string,
  action: string,
): boolean {
  if (!capabilities) return false;
  return (capabilities[resource] ?? []).includes(action);
}
