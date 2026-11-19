import type {
  ClaimResult,
  FeedbackRequest,
  FeedbackResponse,
  OnboardingRequest,
  OnboardingResponse,
  PaceLogRequest,
  PaceLogResponse,
  RecommendRequest,
  RecommendResponse,
  UploadResponse,
  UserProfileResponse,
} from './types'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL

async function apiFetch(path: string, idToken: string | null, init: RequestInit = {}): Promise<Response> {
  if (!API_BASE_URL) {
    throw new Error('NEXT_PUBLIC_API_BASE_URL is not configured')
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`
  }
  return fetch(`${API_BASE_URL}${path}`, { ...init, headers })
}

async function parseOrThrow<T>(res: Response, fallbackMessage: string): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `${fallbackMessage} (status ${res.status})`)
  }
  return res.json()
}

export async function uploadShelfImage(
  userId: string,
  imageBase64: string,
  imageType: string
): Promise<UploadResponse> {
  const res = await apiFetch('/upload', null, {
    method: 'POST',
    body: JSON.stringify({ userId, imageBase64, imageType }),
  })
  return parseOrThrow(res, 'Upload failed')
}

export async function getUserProfile(userId: string, idToken: string | null = null): Promise<UserProfileResponse> {
  const path = idToken ? '/me/profile' : `/user/${userId}/profile`
  const res = await apiFetch(path, idToken)
  return parseOrThrow(res, 'Fetching profile failed')
}

export async function submitFeedback(
  payload: FeedbackRequest,
  idToken: string | null = null
): Promise<FeedbackResponse> {
  const path = idToken ? '/me/feedback' : '/feedback'
  const res = await apiFetch(path, idToken, { method: 'POST', body: JSON.stringify(payload) })
  return parseOrThrow(res, 'Submitting feedback failed')
}

export async function getRecommendations(
  payload: RecommendRequest,
  idToken: string | null = null
): Promise<RecommendResponse> {
  const path = idToken ? '/me/recommend' : '/recommend'
  const res = await apiFetch(path, idToken, { method: 'POST', body: JSON.stringify(payload) })
  return parseOrThrow(res, 'Getting recommendations failed')
}

export async function logPaceSession(
  userId: string,
  payload: PaceLogRequest,
  idToken: string | null = null
): Promise<PaceLogResponse> {
  const path = idToken ? '/me/pace-log' : `/user/${userId}/pace-log`
  const res = await apiFetch(path, idToken, { method: 'POST', body: JSON.stringify(payload) })
  return parseOrThrow(res, 'Logging pace session failed')
}

export async function submitOnboarding(
  userId: string,
  payload: OnboardingRequest,
  idToken: string | null = null
): Promise<OnboardingResponse> {
  const path = idToken ? '/me/onboarding' : `/user/${userId}/onboarding`
  const res = await apiFetch(path, idToken, { method: 'POST', body: JSON.stringify(payload) })
  return parseOrThrow(res, 'Submitting onboarding failed')
}

export async function claimAnonymousData(idToken: string, anonymousUserId: string): Promise<ClaimResult> {
  const res = await apiFetch('/me/claim', idToken, {
    method: 'POST',
    body: JSON.stringify({ anonymousUserId }),
  })
  return parseOrThrow(res, 'Claiming guest data failed')
}
