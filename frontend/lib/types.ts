export interface ExtractedTitle {
  title: string
  author: string | null
  pageCount: number | null
  genres: string[]
  confidence: number
  matched: boolean
}

export interface UploadResponse {
  sessionId: string
  extractedTitles: ExtractedTitle[]
  processingTimeMs: number
  message?: string
}
