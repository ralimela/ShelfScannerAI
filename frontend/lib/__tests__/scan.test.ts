import { mergeUploadResults } from '@/lib/scan'
import type { ExtractedTitle, UploadResponse } from '@/lib/types'

function title(name: string, confidence: number, author: string | null = null): ExtractedTitle {
  return { title: name, author, pageCount: null, genres: [], confidence, matched: true }
}

function upload(sessionId: string, titles: ExtractedTitle[], processingTimeMs: number, message?: string): UploadResponse {
  return { sessionId, extractedTitles: titles, processingTimeMs, ...(message && { message }) }
}

describe('mergeUploadResults', () => {
  it('dedupes a book seen in two photos, keeping the most confident read', () => {
    const merged = mergeUploadResults([
      upload('sess_a', [title('The Shining', 0.7), title('Dune', 0.9)], 4000),
      upload('sess_b', [title('the shining!', 0.95, 'Stephen King'), title('Hyperion', 0.8)], 6500),
    ])

    expect(merged.sessionId).toBe('sess_a')
    expect(merged.processingTimeMs).toBe(6500)
    expect(merged.extractedTitles.map((t) => t.title)).toEqual(['the shining!', 'Dune', 'Hyperion'])
    expect(merged.extractedTitles[0].author).toBe('Stephen King')
  })

  it('combines distinct messages and omits the field when there are none', () => {
    expect(mergeUploadResults([upload('a', [], 1), upload('b', [], 2)])).not.toHaveProperty('message')
    const merged = mergeUploadResults([upload('a', [], 1, 'No text found.'), upload('b', [], 2, 'No text found.')])
    expect(merged.message).toBe('No text found.')
  })
})
