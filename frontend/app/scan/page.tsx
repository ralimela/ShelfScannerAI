'use client'

import { useEffect, useState } from 'react'
import ImageUploader from '@/components/ImageUploader'
import RecommendationList from '@/components/RecommendationList'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import Pill from '@/components/ui/Pill'
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
    <main className="flex flex-col items-center gap-8 px-6 py-10 flex-1">
      <h1 className="text-2xl font-semibold">Scan a Bookshelf</h1>

      <ImageUploader onUpload={handleUpload} isUploading={isUploading} />

      {error && <p className="text-danger">{error}</p>}

      {result && (
        <div className="w-full max-w-md flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {result.extractedTitles.length} title(s) found in {result.processingTimeMs}ms
          </p>

          {result.message && <p className="text-sm text-muted-foreground">{result.message}</p>}

          {result.extractedTitles.map((title, i) => (
            <Card key={i}>
              <p className="font-medium">{title.title}</p>
              {title.author && <p className="text-sm text-muted-foreground">{title.author}</p>}
              <div className="flex gap-2 text-xs text-muted-foreground mt-1 flex-wrap">
                {title.pageCount && <Pill>{title.pageCount} pages</Pill>}
                <Pill>{Math.round(title.confidence * 100)}% confidence</Pill>
                {!title.matched && <Pill>no Open Library match</Pill>}
              </div>
            </Card>
          ))}

          {result.extractedTitles.length > 0 && !recommendations && (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={explorationMode === 'preference' ? 'primary' : 'outline'}
                  onClick={() => setExplorationMode('preference')}
                  className="flex-1"
                >
                  Go with Preference
                </Button>
                <Button
                  type="button"
                  variant={explorationMode === 'novelty' ? 'primary' : 'outline'}
                  onClick={() => setExplorationMode('novelty')}
                  className="flex-1"
                >
                  Try Something New
                </Button>
              </div>

              <Button type="button" onClick={handleGetRecommendations} disabled={isRecommending}>
                {isRecommending ? 'Finding your next read…' : 'Get Recommendations'}
              </Button>
            </div>
          )}

          {recommendError && <p className="text-danger text-sm">{recommendError}</p>}
        </div>
      )}

      {recommendations && (
        <div className="w-full max-w-md flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
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
