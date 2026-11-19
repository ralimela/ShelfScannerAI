'use client'

import { useState } from 'react'
import { submitOnboarding } from '@/lib/api'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import Input from '@/components/ui/Input'
import type { OnboardingResponse } from '@/lib/types'

interface OnboardingFormProps {
  userId: string
  idToken?: string | null
  onSubmitted?: (response: OnboardingResponse) => void
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export default function OnboardingForm({ userId, idToken = null, onSubmitted }: OnboardingFormProps) {
  const [favoriteAuthors, setFavoriteAuthors] = useState('')
  const [favoriteGenres, setFavoriteGenres] = useState('')
  const [dislikedGenres, setDislikedGenres] = useState('')
  const [writingStylePrefs, setWritingStylePrefs] = useState('')
  const [avoidThemes, setAvoidThemes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      const response = await submitOnboarding(
        userId,
        {
          favoriteAuthors: splitList(favoriteAuthors),
          favoriteGenres: splitList(favoriteGenres),
          dislikedGenres: splitList(dislikedGenres),
          writingStylePrefs: splitList(writingStylePrefs),
          avoidThemes: splitList(avoidThemes),
        },
        idToken
      )
      setSubmitted(true)
      onSubmitted?.(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submitting preferences failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card className="w-full max-w-md">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <h2 className="font-medium">Tell Us What You Like</h2>
        <p className="text-xs text-muted-foreground">
          No reading history yet — share a few preferences so recommendations have something to work with.
        </p>

        <Input
          type="text"
          placeholder="Favorite authors (comma separated)"
          value={favoriteAuthors}
          onChange={(e) => setFavoriteAuthors(e.target.value)}
        />
        <Input
          type="text"
          placeholder="Favorite genres (comma separated)"
          value={favoriteGenres}
          onChange={(e) => setFavoriteGenres(e.target.value)}
        />
        <Input
          type="text"
          placeholder="Genres you dislike (comma separated)"
          value={dislikedGenres}
          onChange={(e) => setDislikedGenres(e.target.value)}
        />
        <Input
          type="text"
          placeholder="Writing styles you enjoy (e.g. atmospheric, fast-paced)"
          value={writingStylePrefs}
          onChange={(e) => setWritingStylePrefs(e.target.value)}
        />
        <Input
          type="text"
          placeholder="Themes to avoid"
          value={avoidThemes}
          onChange={(e) => setAvoidThemes(e.target.value)}
        />

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save Preferences'}
        </Button>

        {error && <p className="text-danger text-sm">{error}</p>}
        {submitted && <p className="text-sm text-muted-foreground">Preferences saved.</p>}
      </form>
    </Card>
  )
}
