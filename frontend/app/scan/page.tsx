'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import ImageUploader from '@/components/ImageUploader'
import RecommendationList from '@/components/RecommendationList'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import Pill from '@/components/ui/Pill'
import { getRecommendations, uploadShelfImage } from '@/lib/api'
import { useAuth } from '@/lib/AuthContext'
import { fileToCompressedBase64 } from '@/lib/imageUtils'
import { mergeUploadResults } from '@/lib/scan'
import { getOrCreateUserId } from '@/lib/user'
import type { RecommendResponse, UploadResponse } from '@/lib/types'

export default function ScanPage() {
  const { user, idToken } = useAuth()
  const [anonymousUserId, setAnonymousUserId] = useState<string | null>(null)
  const userId = user?.userId ?? anonymousUserId
  const [isUploading, setIsUploading] = useState(false)
  const [result, setResult] = useState<UploadResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [partialFailures, setPartialFailures] = useState(0)
  const [isRecommending, setIsRecommending] = useState(false)
  const [recommendations, setRecommendations] = useState<RecommendResponse | null>(null)
  const [recommendError, setRecommendError] = useState<string | null>(null)
  const [explorationMode, setExplorationMode] = useState<'preference' | 'novelty'>('preference')

  useEffect(() => {
    if (user) return
    // localStorage isn't available during SSR, so this id must be read client-side in an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnonymousUserId(getOrCreateUserId())
  }, [user])

  const handleScan = async (files: File[]) => {
    if (!userId) return
    setIsUploading(true)
    setError(null)
    setPartialFailures(0)
    setResult(null)
    setRecommendations(null)
    setRecommendError(null)

    const outcomes = await Promise.allSettled(
      files.map(async (file) => {
        const { base64, contentType } = await fileToCompressedBase64(file)
        return uploadShelfImage(userId, base64, contentType)
      })
    )
    const succeeded = outcomes.flatMap((o) => (o.status === 'fulfilled' ? [o.value] : []))
    const firstFailure = outcomes.find((o): o is PromiseRejectedResult => o.status === 'rejected')

    if (succeeded.length === 0) {
      const reason = firstFailure?.reason
      setError(reason instanceof Error ? reason.message : 'Upload failed')
    } else {
      setResult(mergeUploadResults(succeeded))
      setPartialFailures(files.length - succeeded.length)
    }
    setIsUploading(false)
  }

  const handleGetRecommendations = async () => {
    if (!userId || !result) return
    setIsRecommending(true)
    setRecommendError(null)
    setRecommendations(null)
    try {
      const response = await getRecommendations(
        {
          userId,
          sessionId: result.sessionId,
          candidates: result.extractedTitles.map((title) => ({
            title: title.title,
            author: title.author,
            pageCount: title.pageCount,
            genres: title.genres,
          })),
          explorationMode,
        },
        idToken
      )
      setRecommendations(response)
    } catch (err) {
      setRecommendError(err instanceof Error ? err.message : 'Getting recommendations failed')
    } finally {
      setIsRecommending(false)
    }
  }

  return (
    <main className="flex flex-col items-center gap-8 px-6 py-10 flex-1">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="font-serif text-4xl tracking-tight">Scan a Bookshelf</h1>
        <p className="text-sm text-muted-foreground">
          No photo handy?{' '}
          <Link href="/ask" className="font-medium text-brand underline-offset-4 hover:underline">
            Ask the reading companion instead
          </Link>
        </p>
      </div>

      <ImageUploader onScan={handleScan} isUploading={isUploading} />

      {error && <p className="text-danger">{error}</p>}

      {result && (
        <div className="w-full max-w-md flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {result.extractedTitles.length} title(s) found in {result.processingTimeMs}ms
          </p>
          {partialFailures > 0 && (
            <p className="text-sm text-danger">
              {partialFailures} photo{partialFailures === 1 ? '' : 's'} couldn&apos;t be read, so these results come from
              the rest.
            </p>
          )}

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
