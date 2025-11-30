import { UserProfile } from "@/lib/types";
import { updateUserProfile, updateUserBalance } from "@/lib/firebase/firestore";

/**
 * Update user profile preferences
 */
export async function updateProfileAction(
  userId: string,
  currentProfile: UserProfile | null,
  updates: Partial<UserProfile["preferences"]>
): Promise<void> {
  await updateUserProfile(userId, {
    preferences: { ...currentProfile?.preferences, ...updates } as UserProfile["preferences"],
  });
}

/**
 * Set user's current balance
 */
export async function setCurrentBalanceAction(userId: string, balance: number): Promise<void> {
  await updateUserBalance(userId, balance);
}

