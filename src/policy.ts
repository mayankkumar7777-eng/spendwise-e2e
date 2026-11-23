export type Role = 'Employee' | 'Manager' | 'Finance';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  managerId: string | null;
}

export interface ClaimOwnership {
  employeeId: string;
  employeeManagerId: string | null;
}

// BR-11/BR-12: the top manager has no manager and does not submit; Finance is read-only (BR-14).
export function canSubmit(user: User): boolean {
  return user.role !== 'Finance' && user.managerId !== null;
}

// Owner, the owner's manager and Finance (NFR-05, BR-13, BR-14).
export function canView(user: User, claim: ClaimOwnership): boolean {
  return user.id === claim.employeeId || user.id === claim.employeeManagerId || user.role === 'Finance';
}

export function canModify(user: User, claim: ClaimOwnership): boolean {
  return user.id === claim.employeeId;
}

export type DecisionCheck = 'ok' | 'self' | 'forbidden';

// BR-06 and BR-10.
export function checkDecision(user: User, claim: ClaimOwnership): DecisionCheck {
  if (user.id === claim.employeeId) return 'self';
  if (user.role !== 'Manager' || claim.employeeManagerId !== user.id) return 'forbidden';
  return 'ok';
}
