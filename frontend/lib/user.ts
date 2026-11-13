const USER_ID_STORAGE_KEY = 'shelfscannerai_user_id'

export function getOrCreateUserId(): string {
  let userId = localStorage.getItem(USER_ID_STORAGE_KEY)
  if (!userId) {
    userId = `user_${crypto.randomUUID().slice(0, 8)}`
    localStorage.setItem(USER_ID_STORAGE_KEY, userId)
  }
  return userId
}
