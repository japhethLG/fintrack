/**
 * A one-shot message that must survive a redirect (e.g. "your account deletion was incomplete" shown on the
 * login page after the user has been signed out). Stored in sessionStorage; read once.
 */
const KEY = "fintrack_flash_notice";

export const setFlashNotice = (message: string): void => {
  try {
    sessionStorage.setItem(KEY, message);
  } catch {
    // storage unavailable (private mode): the message is lost, nothing else depends on it
  }
};

/** Returns the pending notice and clears it. */
export const takeFlashNotice = (): string | null => {
  try {
    const message = sessionStorage.getItem(KEY);
    if (message !== null) sessionStorage.removeItem(KEY);
    return message;
  } catch {
    return null;
  }
};
