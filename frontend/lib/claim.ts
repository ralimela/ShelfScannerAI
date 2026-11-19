import { claimAnonymousData } from '@/lib/api'
import { getStoredAnonymousUserId } from '@/lib/user'
import type { ClaimResult } from '@/lib/types'

const CLAIMED_FLAG_PREFIX = 'shelfscannerai_claimed_'

/** Runs the guest-data claim at most once per authenticated account, ever
 * (not once per session) - the flag is keyed by the signed-in user's own
 * id, not a session timestamp, so re-logging in never re-triggers it. */
export async function claimAnonymousDataOnce(authenticatedUserId: string, idToken: string): Promise<ClaimResult | null> {
  const claimedFlagKey = `${CLAIMED_FLAG_PREFIX}${authenticatedUserId}`
  try {
    if (localStorage.getItem(claimedFlagKey)) {
      return null
    }
  } catch {
    return null
  }

  const anonymousUserId = getStoredAnonymousUserId()
  if (!anonymousUserId || anonymousUserId === authenticatedUserId) {
    return null
  }

  try {
    const result = await claimAnonymousData(idToken, anonymousUserId)
    localStorage.setItem(claimedFlagKey, '1')
    return result
  } catch {
    // A failed claim attempt should not block sign-in, and should be safe
    // to retry on the next login - don't set the flag.
    return null
  }
}
