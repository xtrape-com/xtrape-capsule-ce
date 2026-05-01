export type AdminRole = "owner" | "operator" | "viewer";

export interface RoleBearingUser {
  role: string;
}

export function requireRole(user: RoleBearingUser, roles: AdminRole[]): void {
  if (!roles.includes(user.role as AdminRole)) {
    throw Object.assign(new Error("Insufficient permissions."), { statusCode: 403, code: "FORBIDDEN" });
  }
}

export function requireOwner(user: RoleBearingUser): void {
  requireRole(user, ["owner"]);
}

export function requireOperator(user: RoleBearingUser): void {
  requireRole(user, ["owner", "operator"]);
}
