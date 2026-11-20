import type { ExtractedTitle, UploadResponse } from './types'

export const MAX_PHOTOS = 3

function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Combines per-photo scan results into one. Overlapping photos of the same
 * shelf will often catch the same spine twice, so books are de-duplicated by
 * normalized title, keeping whichever read was most confident. */
export function mergeUploadResults(results: UploadResponse[]): UploadResponse {
  const byTitle = new Map<string, ExtractedTitle>()
  for (const result of results) {
    for (const title of result.extractedTitles) {
      const key = titleKey(title.title)
      const existing = byTitle.get(key)
      if (!existing || title.confidence > existing.confidence) {
        byTitle.set(key, title)
      }
    }
  }

  const messages = [...new Set(results.map((r) => r.message).filter((m): m is string => Boolean(m)))]
  return {
    sessionId: results[0]?.sessionId ?? '',
    extractedTitles: [...byTitle.values()],
    processingTimeMs: Math.max(0, ...results.map((r) => r.processingTimeMs)),
    ...(messages.length > 0 && { message: messages.join(' ') }),
  }
}
