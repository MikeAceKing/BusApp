export type PasswordPolicyErrorCode =
  | 'password_too_short'
  | 'password_missing_uppercase'
  | 'password_missing_lowercase'
  | 'password_missing_number'
  | 'password_missing_symbol';

export const PASSWORD_POLICY_MIN_LENGTH = 12;

// Login accepts legacy passwords. Apply the stronger policy only when setting one.
export function validateLoginPassword(password: string): boolean {
  return password.length > 0;
}

export const PASSWORD_POLICY_COPY = {
  en: 'At least 12 characters, including uppercase, lowercase, a number and a symbol.',
  fr: 'Au moins 12 caractères, dont une majuscule, une minuscule, un chiffre et un symbole.',
  nl: 'Minstens 12 tekens, met een hoofdletter, kleine letter, cijfer en symbool.',
} as const;

export function validatePasswordPolicy(password: string): { valid: true } | { valid: false; message: PasswordPolicyErrorCode } {
  const value = String(password || '');
  if (value.length < PASSWORD_POLICY_MIN_LENGTH) return { valid: false, message: 'password_too_short' };
  if (!/[A-Z]/.test(value)) return { valid: false, message: 'password_missing_uppercase' };
  if (!/[a-z]/.test(value)) return { valid: false, message: 'password_missing_lowercase' };
  if (!/[0-9]/.test(value)) return { valid: false, message: 'password_missing_number' };
  if (!/[^A-Za-z0-9]/.test(value)) return { valid: false, message: 'password_missing_symbol' };
  return { valid: true };
}
