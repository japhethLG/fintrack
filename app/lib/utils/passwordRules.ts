/**
 * Client-side password rules of the sign-up form.
 */

/** Firebase's own minimum; checked here too so the user is told before anything is sent. */
export const MIN_PASSWORD_LENGTH = 6;

export interface SignupPasswordErrors {
  password?: string;
  confirmPassword?: string;
}

/** The sign-up form's checks: the password's length first, then that both entries agree. */
export const validateSignupPasswords = (
  password: string,
  confirmPassword: string
): SignupPasswordErrors => {
  const errors: SignupPasswordErrors = {};
  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  } else if (password !== confirmPassword) {
    errors.confirmPassword = "Passwords do not match.";
  }
  return errors;
};
