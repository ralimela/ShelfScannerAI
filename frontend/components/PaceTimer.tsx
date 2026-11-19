'use client'

import { useEffect, useState } from 'react'
import { Timer } from 'lucide-react'
import { logPaceSession } from '@/lib/api'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import type { PaceLogResponse } from '@/lib/types'

interface PaceTimerProps {
  userId: string
  idToken?: string | null
  onLogged?: (response: PaceLogResponse) => void
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export default function PaceTimer({ userId, idToken = null, onLogged }: PaceTimerProps) {
  const [startedAt, setStartedAt] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [pagesRead, setPagesRead] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<PaceLogResponse | null>(null)

  useEffect(() => {
    if (!startedAt) return
    const start = new Date(startedAt).getTime()
    const interval = setInterval(() => setElapsedMs(Date.now() - start), 1000)
    return () => clearInterval(interval)
  }, [startedAt])

  const handleStart = () => {
    setError(null)
    setLastResult(null)
    setElapsedMs(0)
    setStartedAt(new Date().toISOString())
  }

  const handleCancel = () => {
    setStartedAt(null)
    setElapsedMs(0)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!startedAt) return
    const pages = Number(pagesRead)
    if (!pages || pages <= 0) {
      setError('Enter how many pages you read')
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      const response = await logPaceSession(
        userId,
        {
          title: title || undefined,
          author: author || undefined,
          startedAt,
          endedAt: new Date().toISOString(),
          pagesRead: pages,
        },
        idToken
      )
      setLastResult(response)
      onLogged?.(response)
      setStartedAt(null)
      setElapsedMs(0)
      setTitle('')
      setAuthor('')
      setPagesRead('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logging this session failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-medium flex items-center gap-2">
        <Timer className="w-4 h-4 text-brand" />
        Reading Timer
      </h2>

      {!startedAt && (
        <Button type="button" variant="outline" onClick={handleStart}>
          Start Reading Session
        </Button>
      )}

      {startedAt && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Reading for <span className="font-medium text-foreground">{formatElapsed(elapsedMs)}</span>
          </p>
          <Input placeholder="Book title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input placeholder="Author (optional)" value={author} onChange={(e) => setAuthor(e.target.value)} />
          <Input
            type="number"
            min={1}
            placeholder="Pages read this session"
            value={pagesRead}
            onChange={(e) => setPagesRead(e.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={isSubmitting} className="flex-1">
              {isSubmitting ? 'Logging…' : 'Stop & Log Pages'}
            </Button>
            <Button type="button" variant="ghost" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {error && <p className="text-danger text-sm">{error}</p>}

      {lastResult && (
        <p className="text-sm text-muted-foreground">
          That session: {lastResult.session.pagesPerHour} pages/hour. New rolling average:{' '}
          <span className="font-medium text-foreground">{lastResult.readingPace.avgPagesPerHour} pages/hour</span>.
        </p>
      )}
    </div>
  )
}
