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

export interface TasteProfile {
  favoriteAuthors: string[]
  favoriteGenres: string[]
  dislikedGenres: string[]
  preferredPacing: string | null
  preferredLength: string | null
  writingStylePrefs: string[]
  avoidThemes: string[]
  lastUpdated: string
}

export interface ReadingPace {
  avgPagesPerHour: number
  totalSessions: number
}

export interface RecentBook {
  bookId: string
  title: string | null
  author: string | null
  rating: number | null
  readAt: string | null
}

export interface UserProfileResponse {
  userId: string
  tasteProfile: TasteProfile
  readingPace: ReadingPace
  totalBooksRead: number
  recentBooks: RecentBook[]
}

export interface FeedbackRequest {
  userId: string
  bookId: string
  rating: number
  feedbackText: string
  title?: string
  author?: string
  genres?: string[]
  startedAt?: string
  finishedAt?: string
}

export interface FeedbackResponse {
  success: boolean
  tasteProfileUpdated: boolean
  extractedSignals: {
    likedElements: string[]
    dislikedElements: string[]
    authorStyleRating: number | null
  }
}
