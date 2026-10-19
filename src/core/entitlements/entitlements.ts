import type { Caller, Role } from "../auth/caller";

const priceRoles: ReadonlySet<Role> = new Set<Role>(["sales_engineer", "administrator"]);

export function canSeePrice(caller: Caller): boolean {
  return priceRoles.has(caller.role);
}
