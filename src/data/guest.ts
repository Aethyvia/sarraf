/**
 * Guest mode (owner, Nov 14): "Continue as guest" on Welcome. Everything works
 * on the phone on the free plan; backup and Sarraf Plus wait for a Sarraf
 * account. Signing in later goes through the usual steps (Keep what's on this
 * phone, or replace it with a backup).
 */

const DAY = 86_400_000;

/**
 * Home's gentle "Your money is only on this phone" card: for a guest, after 7
 * days or 20 transactions, and again 30 days after it was last closed.
 */
export function showGuestReminder(f: {
  signedIn: boolean;
  onboardedAt: string | null;
  transactionCount: number;
  dismissedAt: string | null;
  now: string;
}): boolean {
  if (f.signedIn || !f.onboardedAt) return false;
  const now = Date.parse(f.now);
  if (f.dismissedAt && now - Date.parse(f.dismissedAt) < 30 * DAY) return false;
  return now - Date.parse(f.onboardedAt) >= 7 * DAY || f.transactionCount >= 20;
}
