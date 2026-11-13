'use client'

import { useState } from 'react'
import { submitFeedback } from '@/lib/api'
import type { FeedbackResponse } from '@/lib/types'

interface FeedbackFormProps {
  userId: string
  onSubmitted?: (response: FeedbackResponse) => void
}

export default function FeedbackForm({ userId, onSubmitted }: FeedbackFormProps) {
  const [bookId, setBookId] = useState('')
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [rating, setRating] = useState(5)
  const [feedbackText, setFeedbackText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<FeedbackResponse | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!bookId || !feedbackText) return

    setIsSubmitting(true)
    setError(null)
    setResult(null)
    try {
      const response = await submitFeedback({
        userId,
        bookId,
        rating,
        feedbackText,
        title: title || undefined,
        author: author || undefined,
        finishedAt: new Date().toISOString(),
      })
      setResult(response)
      onSubmitted?.(response)
      setBookId('')
      setTitle('')
      setAuthor('')
      setFeedbackText('')
      setRating(5)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submitting feedback failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md flex flex-col gap-3 border rounded-xl p-4">
      <h2 className="font-medium">Log a Finished Book</h2>

      <input
        type="text"
        placeholder="Book ID (ISBN or title#author slug)"
        value={bookId}
        onChange={(e) => setBookId(e.target.value)}
        className="border rounded-lg px-3 py-2 text-sm"
        required
      />
      <input
        type="text"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="border rounded-lg px-3 py-2 text-sm"
      />
      <input
        type="text"
        placeholder="Author"
        value={author}
        onChange={(e) => setAuthor(e.target.value)}
        className="border rounded-lg px-3 py-2 text-sm"
      />

      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">Rating</span>
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setRating(value)}
            className={value <= rating ? 'text-black dark:text-white' : 'text-gray-300'}
            aria-label={`Rate ${value} stars`}
          >
            ★
          </button>
        ))}
      </div>

      <textarea
        placeholder="What did you think of it?"
        value={feedbackText}
        onChange={(e) => setFeedbackText(e.target.value)}
        className="border rounded-lg px-3 py-2 text-sm min-h-24"
        required
      />

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-full bg-black text-white py-2 font-medium disabled:opacity-50"
      >
        {isSubmitting ? 'Updating taste profile…' : 'Submit Feedback'}
      </button>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {result && (
        <div className="text-sm text-gray-600 dark:text-zinc-400 flex flex-col gap-1">
          <p>Taste profile updated.</p>
          {result.extractedSignals.likedElements.length > 0 && (
            <p>Liked: {result.extractedSignals.likedElements.join(', ')}</p>
          )}
          {result.extractedSignals.dislikedElements.length > 0 && (
            <p>Disliked: {result.extractedSignals.dislikedElements.join(', ')}</p>
          )}
        </div>
      )}
    </form>
  )
}
