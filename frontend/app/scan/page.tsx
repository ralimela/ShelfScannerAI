'use client'

import { useEffect, useState } from 'react'
import ImageUploader from '@/components/ImageUploader'
import RecommendationList from '@/components/RecommendationList'
import { getRecommendations, uploadShelfImage } from '@/lib/api'
import { getOrCreateUserId } from '@/lib/user'
import type { RecommendResponse, UploadResponse } from '@/lib/types'

export default function ScanPage() {
  const [userId, setUserId] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [result, setResult] = useState<UploadResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isRecommending, setIsRecommending] = useState(false)
  const [recommendations, setRecommendations] = useState<RecommendResponse | null>(null)
  const [recommendError, setRecommendError] = useState<string | null>(null)
  const [explorationMode, setExplorationMode] = useState<'preference' | 'novelty'>('preference')

  useEffect(() => {
    // localStorage isn't available during SSR, so this id must be read client-side in an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUserId(getOrCreateUserId())
  }, [])

  const handleUpload = async (base64: string, contentType: string) => {
    if (!userId) return
    setIsUploading(true)
    setError(null)
    setResult(null)
    setRecommendations(null)
    setRecommendError(null)
    try {
      const response = await uploadShelfImage(userId, base64, contentType)
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  const handleGetRecommendations = async () => {
    if (!userId || !result) return
    setIsRecommending(true)
    setRecommendError(null)
    setRecommendations(null)
    try {
      const response = await getRecommendations({
        userId,
        sessionId: result.sessionId,
        candidates: result.extractedTitles.map((title) => ({
          title: title.title,
          author: title.author,
          pageCount: title.pageCount,
          genres: title.genres,
        })),
        explorationMode,
      })
      setRecommendations(response)
    } catch (err) {
      setRecommendError(err instanceof Error ? err.message : 'Getting recommendations failed')
    } finally {
      setIsRecommending(false)
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center gap-8 p-8">
      <h1 className="text-2xl font-semibold">Scan a Bookshelf</h1>

      <ImageUploader onUpload={handleUpload} isUploading={isUploading} />

      {error && <p className="text-red-600">{error}</p>}

      {result && (
        <div className="w-full max-w-md flex flex-col gap-3">
          <p className="text-sm text-gray-500">
            {result.extractedTitles.length} title(s) found in {result.processingTimeMs}ms
          </p>

          {result.message && <p className="text-sm text-gray-600">{result.message}</p>}

          {result.extractedTitles.map((title, i) => (
            <div key={i} className="border rounded-xl p-4">
              <p className="font-medium">{title.title}</p>
              {title.author && <p className="text-sm text-gray-600">{title.author}</p>}
              <div className="flex gap-3 text-xs text-gray-400 mt-1">
                {title.pageCount && <span>{title.pageCount} pages</span>}
                <span>{Math.round(title.confidence * 100)}% confidence</span>
                {!title.matched && <span>no Open Library match</span>}
              </div>
            </div>
          ))}

          {result.extractedTitles.length > 0 && !recommendations && (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setExplorationMode('preference')}
                  className={
                    explorationMode === 'preference'
                      ? 'flex-1 rounded-full bg-black text-white py-2 text-sm font-medium'
                      : 'flex-1 rounded-full border py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300'
                  }
                >
                  Go with Preference
                </button>
                <button
                  type="button"
                  onClick={() => setExplorationMode('novelty')}
                  className={
                    explorationMode === 'novelty'
                      ? 'flex-1 rounded-full bg-black text-white py-2 text-sm font-medium'
                      : 'flex-1 rounded-full border py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300'
                  }
                >
                  Try Something New
                </button>
              </div>

              <button
                type="button"
                onClick={handleGetRecommendations}
                disabled={isRecommending}
                className="rounded-full bg-black text-white py-2 font-medium disabled:opacity-50"
              >
                {isRecommending ? 'Finding your next read…' : 'Get Recommendations'}
              </button>
            </div>
          )}

          {recommendError && <p className="text-red-600 text-sm">{recommendError}</p>}
        </div>
      )}

      {recommendations && (
        <div className="w-full max-w-md flex flex-col gap-3">
          <p className="text-sm text-gray-500">
            {recommendations.mode === 'cold_start'
              ? 'No reading history yet — matched against a curated catalog using your stated preferences.'
              : 'Matched against your own reading history.'}
            {recommendations.explorationMode === 'novelty' && ' Showing something outside your usual taste.'}
          </p>
          <RecommendationList recommendations={recommendations.recommendations} />
        </div>
      )}
    </main>
  )
}
