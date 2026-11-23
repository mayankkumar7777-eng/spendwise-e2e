export interface FieldError {
  field: string;
  code: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: FieldError[],
  ) {
    super(message);
  }
}

export const unauthenticated = () => new AppError(401, 'UNAUTHENTICATED', 'Log in to continue.');
export const forbidden = () => new AppError(403, 'FORBIDDEN', 'You are not allowed to do this.');
export const notFound = () => new AppError(404, 'NOT_FOUND', 'Not found.');
export const claimLocked = () =>
  new AppError(409, 'CLAIM_LOCKED', 'Approved or rejected claims cannot be changed.');
export const validationFailed = (fields: FieldError[]) =>
  new AppError(422, 'VALIDATION_FAILED', 'Some fields are invalid.', fields);
