'use client'

import { useState } from 'react'
import { Star } from 'lucide-react'
import { submitFeedback } from '@/lib/api'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import Input, { Textarea } from '@/components/ui/Input'
import type { FeedbackResponse } from '@/lib/types'

interface FeedbackFormProps {
  userId: string
  idToken?: string | null
  onSubmitted?: (response: FeedbackResponse) => void
}

export default function FeedbackForm({ userId, idToken = null, onSubmitted }: FeedbackFormProps) {
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
      const response = await submitFeedback(
        {
          userId,
          bookId,
          rating,
          feedbackText,
          title: title || undefined,
          author: author || undefined,
          finishedAt: new Date().toISOString(),
        },
        idToken
      )
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
    <Card className="w-full max-w-md">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <h2 className="font-medium">Log a Finished Book</h2>

        <Input
          type="text"
          placeholder="Book ID (ISBN or title#author slug)"
          value={bookId}
          onChange={(e) => setBookId(e.target.value)}
          required
        />
        <Input type="text" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Input type="text" placeholder="Author" value={author} onChange={(e) => setAuthor(e.target.value)} />

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Rating</span>
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setRating(value)}
              aria-label={`Rate ${value} stars`}
            >
              <Star
                className={value <= rating ? 'w-4 h-4 text-accent fill-accent' : 'w-4 h-4 text-muted-foreground'}
              />
            </button>
          ))}
        </div>

        <Textarea
          placeholder="What did you think of it?"
          value={feedbackText}
          onChange={(e) => setFeedbackText(e.target.value)}
          className="min-h-24"
          required
        />

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Updating taste profile…' : 'Submit Feedback'}
        </Button>

        {error && <p className="text-danger text-sm">{error}</p>}

        {result && (
          <div className="text-sm text-muted-foreground flex flex-col gap-1">
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
    </Card>
  )
}
