import type { UploadResponse } from './types'

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
