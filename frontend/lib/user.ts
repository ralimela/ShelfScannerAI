const USER_ID_STORAGE_KEY = 'shelfscannerai_user_id'

export function getOrCreateUserId(): string {
  let userId = localStorage.getItem(USER_ID_STORAGE_KEY)
  if (!userId) {
    userId = `user_${crypto.randomUUID().slice(0, 8)}`
    localStorage.setItem(USER_ID_STORAGE_KEY, userId)
  }
  return userId
}

/** Read-only variant for the sign-in claim flow - unlike getOrCreateUserId,
 * this must never mint a fresh id just because someone is mid-sign-up with
 * no prior guest activity. */
export function getStoredAnonymousUserId(): string | null {
  return localStorage.getItem(USER_ID_STORAGE_KEY)
}
