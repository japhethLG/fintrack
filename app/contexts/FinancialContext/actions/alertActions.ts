import { markAlertAsRead, dismissAlert } from "@/lib/firebase/firestore";

/**
 * Mark alert as read
 */
export async function markAlertReadAction(id: string): Promise<void> {
  await markAlertAsRead(id);
}

/**
 * Dismiss alert
 */
export async function dismissAlertAction(id: string): Promise<void> {
  await dismissAlert(id);
}

