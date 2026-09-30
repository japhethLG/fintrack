import { UserProfile } from "@/lib/types";
import { updateUserProfile, overrideCurrentBalance } from "@/lib/firebase/firestore";

/**
 * Update user profile preferences. Each preference is written through its own dotted path,
 * so a preference the caller did not mention (or one changed on another device since this
 * copy of the profile was read) is never overwritten.
 */
export async function updateProfileAction(
  userId: string,
  updates: Partial<UserProfile["preferences"]>
): Promise<void> {
  const fields: Record<string, unknown> = {};
  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined) fields[`preferences.${key}`] = value;
  });
  if (Object.keys(fields).length === 0) return;
  await updateUserProfile(userId, fields as Partial<UserProfile>);
}

/**
 * Set user's current balance ("Override Current Balance"). The baseline absorbs the
 * correction, so `currentBalance == initialBalance + SUM(completed)` keeps holding.
 */
export async function setCurrentBalanceAction(userId: string, balance: number): Promise<void> {
  await overrideCurrentBalance(userId, balance);
}

/**
 * Update user's profile picture
 */
export async function updateProfilePictureAction(
  userId: string,
  profilePictureUrl: string
): Promise<void> {
  await updateUserProfile(userId, { profilePictureUrl });
}
