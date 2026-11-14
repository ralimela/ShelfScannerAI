'use client'

import { useState } from 'react'
import { submitOnboarding } from '@/lib/api'
import type { OnboardingResponse } from '@/lib/types'

interface OnboardingFormProps {
  userId: string
  onSubmitted?: (response: OnboardingResponse) => void
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export default function OnboardingForm({ userId, onSubmitted }: OnboardingFormProps) {
  const [favoriteAuthors, setFavoriteAuthors] = useState('')
  const [favoriteGenres, setFavoriteGenres] = useState('')
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
      const response = await submitOnboarding(userId, {
        favoriteAuthors: splitList(favoriteAuthors),
        favoriteGenres: splitList(favoriteGenres),
        writingStylePrefs: splitList(writingStylePrefs),
        avoidThemes: splitList(avoidThemes),
      })
      setSubmitted(true)
      onSubmitted?.(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submitting preferences failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md flex flex-col gap-3 border rounded-xl p-4">
      <h2 className="font-medium">Tell Us What You Like</h2>
      <p className="text-xs text-gray-500">
        No reading history yet — share a few preferences so recommendations have something to work with.
      </p>

      <input
        type="text"
        placeholder="Favorite authors (comma separated)"
        value={favoriteAuthors}
        onChange={(e) => setFavoriteAuthors(e.target.value)}
        className="border rounded-lg px-3 py-2 text-sm"
      />
      <input
        type="text"
        placeholder="Favorite genres (comma separated)"
        value={favoriteGenres}
        onChange={(e) => setFavoriteGenres(e.target.value)}
        className="border rounded-lg px-3 py-2 text-sm"
      />
      <input
        type="text"
        placeholder="Writing styles you enjoy (e.g. atmospheric, fast-paced)"
        value={writingStylePrefs}
        onChange={(e) => setWritingStylePrefs(e.target.value)}
        className="border rounded-lg px-3 py-2 text-sm"
      />
      <input
        type="text"
        placeholder="Themes to avoid"
        value={avoidThemes}
        onChange={(e) => setAvoidThemes(e.target.value)}
        className="border rounded-lg px-3 py-2 text-sm"
      />

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-full bg-black text-white py-2 font-medium disabled:opacity-50"
      >
        {isSubmitting ? 'Saving…' : 'Save Preferences'}
      </button>

      {error && <p className="text-red-600 text-sm">{error}</p>}
      {submitted && <p className="text-sm text-gray-600 dark:text-zinc-400">Preferences saved.</p>}
    </form>
  )
}
