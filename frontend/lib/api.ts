import type { FeedbackRequest, FeedbackResponse, UploadResponse, UserProfileResponse } from './types'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL

export async function uploadShelfImage(
  userId: string,
  imageBase64: string,
  imageType: string
): Promise<UploadResponse> {
  if (!API_BASE_URL) {
    throw new Error('NEXT_PUBLIC_API_BASE_URL is not configured')
  }

  const res = await fetch(`${API_BASE_URL}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, imageBase64, imageType }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Upload failed with status ${res.status}`)
  }

  return res.json()
}

export async function getUserProfile(userId: string): Promise<UserProfileResponse> {
  if (!API_BASE_URL) {
    throw new Error('NEXT_PUBLIC_API_BASE_URL is not configured')
  }

  const res = await fetch(`${API_BASE_URL}/user/${userId}/profile`)

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Fetching profile failed with status ${res.status}`)
  }

  return res.json()
}

export async function submitFeedback(payload: FeedbackRequest): Promise<FeedbackResponse> {
  if (!API_BASE_URL) {
    throw new Error('NEXT_PUBLIC_API_BASE_URL is not configured')
  }

  const res = await fetch(`${API_BASE_URL}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Submitting feedback failed with status ${res.status}`)
  }

  return res.json()
}
