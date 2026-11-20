'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, ImagePlus, X } from 'lucide-react'
import Button from '@/components/ui/Button'
import { MAX_PHOTOS } from '@/lib/scan'

interface Photo {
  id: string
  file: File
  previewUrl: string
}

interface ImageUploaderProps {
  onScan: (files: File[]) => Promise<void>
  isUploading: boolean
}

export default function ImageUploader({ onScan, isUploading }: ImageUploaderProps) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const photosRef = useRef(photos)

  useEffect(() => {
    photosRef.current = photos
  }, [photos])

  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl)), [])

  const addFiles = (fileList: FileList | null) => {
    if (!fileList) return
    const openSlots = MAX_PHOTOS - photos.length
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'))
    setNotice(files.length > openSlots ? `Only ${MAX_PHOTOS} photos per scan, so the extras were left out.` : null)
    const added = files.slice(0, openSlots).map((file) => ({
      id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }))
    setPhotos((current) => [...current, ...added])
    if (inputRef.current) inputRef.current.value = ''
  }

  const removePhoto = (id: string) => {
    setPhotos((current) => {
      const removed = current.find((p) => p.id === id)
      if (removed) URL.revokeObjectURL(removed.previewUrl)
      return current.filter((p) => p.id !== id)
    })
    setNotice(null)
  }

  const canAddMore = photos.length < MAX_PHOTOS && !isUploading

  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
      />

      {photos.length === 0 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isUploading}
          className="flex flex-col items-center gap-3 rounded-card border-2 border-dashed border-border bg-surface/60 px-6 py-10 text-center backdrop-blur-md transition-colors hover:border-brand/60"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand/15">
            <Camera className="h-6 w-6 text-brand" />
          </span>
          <span className="font-medium">Add bookshelf photos</span>
          <span className="text-sm text-muted-foreground">
            Up to {MAX_PHOTOS}: take them now or pick from your library
          </span>
        </button>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {photos.map((photo, i) => (
            <div key={photo.id} className="relative aspect-[3/4] overflow-hidden rounded-xl border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.previewUrl} alt={`Bookshelf photo ${i + 1}`} className="h-full w-full object-cover" />
              {!isUploading && (
                <button
                  type="button"
                  onClick={() => removePhoto(photo.id)}
                  aria-label={`Remove photo ${i + 1}`}
                  className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              {isUploading && <div className="absolute inset-0 animate-pulse bg-background/40" />}
            </div>
          ))}
          {canAddMore && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex aspect-[3/4] flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-brand/60 hover:text-foreground"
            >
              <ImagePlus className="h-5 w-5" />
              <span className="text-xs">Add photo</span>
            </button>
          )}
        </div>
      )}

      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}

      {photos.length > 0 && (
        <Button type="button" onClick={() => onScan(photos.map((p) => p.file))} disabled={isUploading} className="w-full">
          <Camera className="h-4 w-4" />
          {isUploading
            ? `Scanning ${photos.length === 1 ? 'shelf' : `${photos.length} photos`}…`
            : `Scan ${photos.length === 1 ? '1 photo' : `${photos.length} photos`}`}
        </Button>
      )}
    </div>
  )
}
