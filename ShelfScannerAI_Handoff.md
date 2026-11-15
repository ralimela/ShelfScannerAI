# ShelfScannerAI — Claude Code Implementation Handoff

> **Project Type:** AI-powered reading companion agent  
> **Target Roles:** AI Engineer + Cloud (AWS)  
> **Stack:** Next.js · AWS Lambda · Amazon Rekognition · Amazon Bedrock · DynamoDB · S3  
> **Author:** Revanth Kumar Alimela  
> **Status:** Ready to build from scratch

---

## Table of Contents

1. [Project Vision](#1-project-vision)
2. [Problem Statement](#2-problem-statement)
3. [How It Beats Goodreads](#3-how-it-beats-goodreads)
4. [Architecture Overview](#4-architecture-overview)
5. [AWS Services Breakdown](#5-aws-services-breakdown)
6. [Database Schema — DynamoDB](#6-database-schema--dynamodb)
7. [API Design](#7-api-design)
8. [Amazon Bedrock Prompt Architecture](#8-amazon-bedrock-prompt-architecture)
9. [Frontend Structure](#9-frontend-structure)
10. [Phase-by-Phase Roadmap](#10-phase-by-phase-roadmap)
11. [Pending Tasks Checklist](#11-pending-tasks-checklist)
12. [Resume Bullet Targets](#12-resume-bullet-targets)
13. [Cost & Free Tier Guide](#13-cost--free-tier-guide)
14. [Environment Variables](#14-environment-variables)

---

## 1. Project Vision

ShelfScannerAI is a **serverless, AI-powered reading companion agent** that eliminates the friction of choosing your next book. A user standing in a library or bookstore can photograph a stack of books — spines, covers, or a full shelf — and instantly receive a personalized, explainable recommendation based on their complete reading history, taste profile, favorite authors, and reading pace.

Unlike Goodreads (manual catalog, static genre tags, zero AI), ShelfScannerAI:
- Builds your library from a **photo**, not manual entry
- Reasons about **author writing style**, not just genre
- Explains **why** each book is recommended
- Learns from **post-read feedback** in natural language
- Tracks **reading pace** and estimates completion time per book
- Is built **natively on AWS** — every layer is a cloud service

---

## 2. Problem Statement

**The moment Goodreads ignores:** A reader is standing in a library or bookstore holding 10 books they've never heard of. They have 5 minutes to decide. Goodreads requires them to search each title manually, read community reviews from strangers, and get genre-based suggestions that ignore their nuanced taste.

**ShelfScannerAI solves this in three steps:**
1. Photograph the shelf → titles extracted automatically
2. Agent cross-references against personal taste profile
3. Returns ranked recommendations with plain-English reasoning

---

## 3. How It Beats Goodreads

| Feature | Goodreads | ShelfScannerAI |
|---|---|---|
| Book cataloging | Manual search & add | Photo → instant extraction |
| Recommendations | Genre-based, needs 20+ ratings | AI reasoning from first book |
| Explainability | None | "This author writes like X you loved" |
| AI companion | None | Core feature (Bedrock agent) |
| Reading pace tracking | None | Session timer → pages/hour |
| Completion time estimate | None | "~8 hrs based on your pace" |
| Mood/tone discovery | None | Agent reasons on style + pacing |
| In-store use | None | Primary use case |
| Taste profile | Static genre tags | Dynamic — updates every interaction |
| Post-read feedback | Star rating only | Natural language → taste update |

---

## 4. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     USER (Browser / Mobile)                     │
│                  Next.js Frontend — Vercel/Amplify              │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTPS
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      AWS API Gateway                            │
│               REST API — routes all requests                    │
└────┬──────────────┬───────────────┬──────────────┬─────────────┘
     │              │               │              │
     ▼              ▼               ▼              ▼
┌─────────┐  ┌───────────┐  ┌───────────┐  ┌───────────────┐
│ Lambda  │  │  Lambda   │  │  Lambda   │  │    Lambda     │
│ /upload │  │  /recommend│  │ /feedback │  │  /pace-log    │
│ image   │  │            │  │           │  │               │
└────┬────┘  └─────┬─────┘  └─────┬─────┘  └───────┬───────┘
     │             │              │                  │
     ▼             │              │                  │
┌─────────┐        │              │                  │
│   S3    │        │              ▼                  ▼
│ (images)│        │       ┌─────────────────────────────────┐
└────┬────┘        │       │         DynamoDB                │
     │             │       │  Users · Books · Sessions · Pace│
     ▼             │       └─────────────────────────────────┘
┌──────────────┐   │
│  Rekognition │   │
│  DetectText  │   │
└──────┬───────┘   │
       │           │
       ▼           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Amazon Bedrock                               │
│         Claude claude-sonnet-4-6 (Reasoning Agent)             │
│   Input: extracted titles + user taste profile + constraints   │
│   Output: ranked books + plain-English reasoning per book      │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow — Image Upload to Recommendation

```
1. User uploads bookshelf photo
2. Frontend sends image to POST /upload → Lambda
3. Lambda stores image in S3
4. Lambda calls Rekognition DetectText → returns raw text blocks
5. Lambda cleans + deduplicates → extracts likely book titles
6. Lambda enriches titles via Open Library API (free, no key)
7. Lambda fetches user's taste profile from DynamoDB
8. Lambda calls Bedrock with: titles + profile + page counts + pace
9. Bedrock returns: ranked list + reasoning per book
10. Lambda stores scan session to DynamoDB
11. Frontend displays results
```

---

## 5. AWS Services Breakdown

### Amazon Rekognition — Vision Layer
- **API used:** `DetectText` (Group 2 — free tier eligible)
- **Purpose:** Extract text from bookshelf/book cover photos
- **Free tier:** 5,000 images/month for 12 months
- **Input:** S3 image URI
- **Output:** Array of text blocks with confidence scores
- **Post-processing needed:** Filter by confidence > 80%, remove noise, group adjacent text blocks into titles

```python
# Lambda handler — image processing
import boto3

rekognition = boto3.client('rekognition', region_name='us-east-1')

def extract_titles(bucket, key):
    response = rekognition.detect_text(
        Image={'S3Object': {'Bucket': bucket, 'Name': key}}
    )
    
    lines = [
        block['DetectedText']
        for block in response['TextDetections']
        if block['Type'] == 'LINE' and block['Confidence'] > 80
    ]
    
    # Deduplicate and clean
    seen = set()
    titles = []
    for line in lines:
        cleaned = line.strip().title()
        if cleaned not in seen and len(cleaned) > 3:
            seen.add(cleaned)
            titles.append(cleaned)
    
    return titles
```

### Amazon Bedrock — Reasoning Agent Layer
- **Model:** `anthropic.claude-sonnet-4-6` (best reasoning for cost)
- **Purpose:** Rank extracted titles + generate explainable recommendations
- **No free tier** — but at ~$0.003 per 1K tokens, a full recommendation call costs < $0.01
- **Input:** Structured prompt with titles, user taste profile, pace data
- **Output:** JSON ranked recommendations with reasoning strings

### Amazon S3 — Image Storage
- **Bucket:** `shelfscannerai-images-{env}`
- **Purpose:** Store uploaded bookshelf photos
- **Lifecycle policy:** Delete images after 7 days (cost control)
- **Free tier:** 5 GB always free

### AWS Lambda — Compute Layer
- **Runtime:** Python 3.12
- **Functions:** `upload-handler`, `recommend-handler`, `feedback-handler`, `pace-handler`
- **Free tier:** 1M requests/month + 400,000 GB-seconds — always free
- **Timeout:** 30s for recommendation calls (Bedrock latency)

### AWS API Gateway
- **Type:** REST API
- **Auth:** API key for now (JWT via Cognito in v2)
- **Free tier:** 1M calls/month for 12 months

### Amazon DynamoDB — Database Layer
- **Free tier:** 25 GB storage + 25 read/write capacity units — always free
- **Tables:** See full schema in Section 6

### Open Library API (External, Free)
- **Base URL:** `https://openlibrary.org/api/books`
- **No API key required**
- **Usage:** Enrich extracted titles with author, page count, genre, description
- **Rate limit:** Reasonable for portfolio use — no hard published limit

---

## 6. Database Schema — DynamoDB

DynamoDB is NoSQL — design around access patterns, not normalization.

---

### Table 1: `Users`

**Purpose:** Store user identity + evolving taste profile

| Attribute | Type | Description |
|---|---|---|
| `userId` (PK) | String | Cognito sub or UUID |
| `email` | String | User email |
| `createdAt` | String | ISO timestamp |
| `tasteProfile` | Map | Auto-generated taste model (see below) |
| `readingPace` | Map | `{ avgPagesPerHour, totalSessions, lastUpdated }` |
| `totalBooksRead` | Number | Running count |

**`tasteProfile` structure (nested Map):**
```json
{
  "favoriteAuthors": ["Donna Tartt", "Kazuo Ishiguro"],
  "favoriteGenres": ["literary fiction", "psychological thriller"],
  "dislikedGenres": ["self-help", "romance"],
  "preferredPacing": "slow and atmospheric",
  "preferredLength": "medium (250-400 pages)",
  "writingStylePrefs": ["unreliable narrator", "rich prose", "non-linear"],
  "avoidThemes": ["graphic violence", "political"],
  "lastUpdated": "2026-07-25T10:00:00Z"
}
```

**Access patterns:**
- Get user by userId → `GetItem(PK=userId)`
- Update taste profile after feedback → `UpdateItem(PK=userId)`

---

### Table 2: `Books`

**Purpose:** Cache enriched book metadata from Open Library (avoid repeat API calls)

| Attribute | Type | Description |
|---|---|---|
| `bookId` (PK) | String | ISBN or `title#author` slug |
| `title` | String | Cleaned title |
| `author` | String | Primary author |
| `pageCount` | Number | From Open Library |
| `genres` | List | Genre tags |
| `description` | String | Short synopsis |
| `writingStyle` | String | Bedrock-generated style summary |
| `cachedAt` | String | ISO timestamp |
| `ttl` | Number | DynamoDB TTL — expire after 30 days |

**Access patterns:**
- Get book metadata by ID → `GetItem(PK=bookId)`
- Batch get multiple books → `BatchGetItem`

---

### Table 3: `ReadingHistory`

**Purpose:** Every book a user has read, with feedback

| Attribute | Type | Description |
|---|---|---|
| `userId` (PK) | String | Partition key |
| `bookId#readAt` (SK) | String | Sort key for chronological ordering |
| `title` | String | Book title |
| `author` | String | Author name |
| `rating` | Number | 1–5 star rating |
| `feedbackText` | String | "Loved the pacing, hated the ending" |
| `tasteSignals` | Map | Bedrock-extracted signals from feedback |
| `readAt` | String | ISO timestamp |
| `startedAt` | String | ISO timestamp |

**`tasteSignals` structure (extracted by Bedrock from feedbackText):**
```json
{
  "likedElements": ["pacing", "unreliable narrator", "setting"],
  "dislikedElements": ["ending", "pacing in middle third"],
  "authorStyleRating": 4,
  "wouldRecommend": true
}
```

**Access patterns:**
- Get all books by user → `Query(PK=userId)` sorted by `readAt`
- Get recent 10 books → `Query(PK=userId, Limit=10, ScanIndexForward=false)`

---

### Table 4: `ScanSessions`

**Purpose:** Log every bookshelf scan — for metrics and debugging

| Attribute | Type | Description |
|---|---|---|
| `sessionId` (PK) | String | UUID |
| `userId` | String | GSI partition key |
| `scannedAt` | String | ISO timestamp |
| `imageKey` | String | S3 key of uploaded photo |
| `extractedTitles` | List | Raw titles from Rekognition |
| `recommendedBooks` | List | Final ranked recommendations |
| `extractionAccuracy` | Number | % of titles matched to Open Library |
| `processingTimeMs` | Number | End-to-end latency |

**Global Secondary Index (GSI):** `userId-index` → Query all scans by user

---

### Table 5: `PaceSessions`

**Purpose:** Track individual reading sessions for pace calculation

| Attribute | Type | Description |
|---|---|---|
| `userId` (PK) | String | Partition key |
| `sessionId#startedAt` (SK) | String | Sort key |
| `bookId` | String | Which book |
| `pagesRead` | Number | Pages read this session |
| `durationMinutes` | Number | Session length |
| `pagesPerHour` | Number | Computed: `(pagesRead / durationMinutes) * 60` |
| `sessionDate` | String | ISO date |

**Access patterns:**
- Get all pace sessions for user → `Query(PK=userId)`
- Compute rolling average → aggregate `pagesPerHour` across last 10 sessions

---

## 7. API Design

Base URL: `https://{api-id}.execute-api.us-east-1.amazonaws.com/prod`

---

### POST `/upload`
Upload a bookshelf image and get extracted + enriched titles.

**Request:**
```json
{
  "userId": "user_abc123",
  "imageBase64": "<base64 encoded image>",
  "imageType": "image/jpeg"
}
```

**Response:**
```json
{
  "sessionId": "sess_xyz789",
  "extractedTitles": [
    {
      "title": "The Secret History",
      "author": "Donna Tartt",
      "pageCount": 559,
      "genres": ["literary fiction", "mystery"],
      "confidence": 0.94
    }
  ],
  "processingTimeMs": 1240
}
```

---

### POST `/recommend`
Get AI-ranked recommendations with reasoning from extracted titles.

**Request:**
```json
{
  "userId": "user_abc123",
  "sessionId": "sess_xyz789",
  "titles": ["The Secret History", "Educated", "Normal People"],
  "constraints": {
    "maxCompletionDays": 7,
    "mood": "something atmospheric"
  }
}
```

**Response:**
```json
{
  "recommendations": [
    {
      "rank": 1,
      "title": "The Secret History",
      "author": "Donna Tartt",
      "pageCount": 559,
      "estimatedHours": 14.0,
      "estimatedDays": 3,
      "reasoning": "Donna Tartt's prose style — dense, atmospheric, and psychologically layered — closely mirrors Kazuo Ishiguro, whose 'Never Let Me Go' you rated 5/5 and described as 'hauntingly slow in the best way.' The unreliable narrator structure you've consistently rated highly also features prominently here.",
      "matchScore": 0.91
    }
  ],
  "tasteProfileUsed": {
    "favoriteAuthors": ["Kazuo Ishiguro"],
    "preferredPacing": "slow and atmospheric"
  }
}
```

---

### POST `/feedback`
Submit post-read feedback. Triggers taste profile update via Bedrock.

**Request:**
```json
{
  "userId": "user_abc123",
  "bookId": "isbn_0679410325",
  "rating": 5,
  "feedbackText": "Absolutely loved the writing style and the slow build. The ending felt a bit rushed but I'd read anything by this author again.",
  "startedAt": "2026-07-18T00:00:00Z",
  "finishedAt": "2026-07-25T00:00:00Z"
}
```

**Response:**
```json
{
  "success": true,
  "tasteProfileUpdated": true,
  "extractedSignals": {
    "likedElements": ["writing style", "slow build", "author"],
    "dislikedElements": ["ending pacing"],
    "authorStyleRating": 5
  }
}
```

---

### POST `/pace-log`
Log a reading session for pace tracking.

**Request:**
```json
{
  "userId": "user_abc123",
  "bookId": "isbn_0679410325",
  "pagesRead": 45,
  "durationMinutes": 62
}
```

**Response:**
```json
{
  "pagesPerHour": 43.5,
  "rollingAverage": 41.2,
  "totalSessions": 8,
  "message": "Your average reading pace is 41 pages/hour"
}
```

---

### GET `/user/{userId}/profile`
Get user taste profile and reading stats.

**Response:**
```json
{
  "userId": "user_abc123",
  "tasteProfile": { ... },
  "readingPace": {
    "avgPagesPerHour": 41.2,
    "totalSessions": 8
  },
  "totalBooksRead": 12,
  "recentBooks": [ ... ]
}
```

---

## 8. Amazon Bedrock Prompt Architecture

Two distinct prompt types. Both call `anthropic.claude-sonnet-4-6`.

---

### Prompt 1 — Recommendation Agent

```python
RECOMMENDATION_SYSTEM_PROMPT = """
You are a personal reading companion with deep knowledge of literature, 
author writing styles, narrative structures, and reader psychology.

Your job is to analyze a list of available books against a reader's personal 
taste profile and recommend the best match with clear, specific reasoning.

RULES:
- Always explain WHY a book matches based on specific taste signals
- Reference specific authors, books, or elements the user has enjoyed before
- Never give generic recommendations like "it's highly rated"
- Factor in reading pace and completion time if provided
- Rank by match quality, not popularity
- Return valid JSON only — no preamble, no markdown

OUTPUT FORMAT:
{
  "recommendations": [
    {
      "rank": 1,
      "title": "string",
      "author": "string",
      "reasoning": "string — specific, personal, references their history",
      "matchScore": 0.0-1.0,
      "estimatedHours": number,
      "matchedSignals": ["signal1", "signal2"]
    }
  ]
}
"""

def build_recommendation_prompt(titles_with_metadata, taste_profile, pace):
    return f"""
AVAILABLE BOOKS (extracted from bookshelf photo):
{json.dumps(titles_with_metadata, indent=2)}

USER TASTE PROFILE:
{json.dumps(taste_profile, indent=2)}

USER READING PACE:
- Average pages per hour: {pace['avgPagesPerHour']}
- Preferred length: {taste_profile.get('preferredLength', 'no preference')}

Rank the available books for this reader. For each book, write reasoning 
that is specific to THIS reader's history — not generic praise.
Only include books you can make a strong case for. Skip poor matches entirely.
"""
```

---

### Prompt 2 — Feedback Signal Extractor

```python
FEEDBACK_SYSTEM_PROMPT = """
You are analyzing a reader's post-book feedback to extract structured taste signals.
These signals will update their permanent taste profile for future recommendations.

Extract what they liked and disliked at the level of:
- Writing style (prose density, sentence structure, voice)
- Narrative structure (pacing, timeline, POV)  
- Themes and subject matter
- Author traits

Return valid JSON only — no preamble.

OUTPUT FORMAT:
{
  "likedElements": ["list of specific liked elements"],
  "dislikedElements": ["list of specific disliked elements"],
  "authorStyleRating": 1-5,
  "wouldRecommendSimilar": true/false,
  "tasteProfileUpdates": {
    "addToPreferred": ["element to add to preferences"],
    "addToAvoided": ["element to add to avoid list"],
    "writingStyleSignals": ["new signals to track"]
  }
}
"""

def build_feedback_prompt(feedback_text, book_metadata, existing_profile):
    return f"""
BOOK: {book_metadata['title']} by {book_metadata['author']}
GENRE: {', '.join(book_metadata.get('genres', []))}

READER FEEDBACK:
"{feedback_text}"

EXISTING TASTE PROFILE:
{json.dumps(existing_profile, indent=2)}

Extract taste signals from this feedback and suggest updates to the profile.
"""
```

---

## 9. Frontend Structure

**Framework:** Next.js 14 (App Router)  
**Styling:** Tailwind CSS  
**Deployment:** AWS Amplify or Vercel  
**State management:** React useState + Context API (no Redux needed)

```
shelfscannerai/
├── app/
│   ├── page.tsx                 # Landing / home
│   ├── scan/
│   │   └── page.tsx             # Camera upload + scan results
│   ├── recommendations/
│   │   └── page.tsx             # Ranked book list with reasoning
│   ├── history/
│   │   └── page.tsx             # Reading history + feedback forms
│   ├── pace/
│   │   └── page.tsx             # Reading timer + pace stats
│   └── profile/
│       └── page.tsx             # Taste profile visualization
├── components/
│   ├── ImageUploader.tsx        # Camera / file upload with preview
│   ├── BookCard.tsx             # Single book with reasoning expanded
│   ├── TasteProfileWidget.tsx   # Visual taste profile display
│   ├── PaceTimer.tsx            # Start/stop reading session timer
│   ├── FeedbackForm.tsx         # Post-read rating + text feedback
│   └── RecommendationList.tsx   # Ranked list of books
├── lib/
│   ├── api.ts                   # All API Gateway calls
│   ├── imageUtils.ts            # Base64 conversion, compression
│   └── types.ts                 # TypeScript interfaces
└── public/
    └── icons/
```

### Key Component — PaceTimer

```tsx
// components/PaceTimer.tsx
'use client'
import { useState, useEffect } from 'react'

export default function PaceTimer({ bookId, userId }: { bookId: string, userId: string }) {
  const [isRunning, setIsRunning] = useState(false)
  const [startTime, setStartTime] = useState<number | null>(null)
  const [elapsedMinutes, setElapsedMinutes] = useState(0)
  const [pagesRead, setPagesRead] = useState('')

  useEffect(() => {
    let interval: NodeJS.Timeout
    if (isRunning) {
      interval = setInterval(() => {
        setElapsedMinutes(Math.floor((Date.now() - startTime!) / 60000))
      }, 10000)
    }
    return () => clearInterval(interval)
  }, [isRunning, startTime])

  const handleStart = () => {
    setStartTime(Date.now())
    setIsRunning(true)
  }

  const handleStop = async () => {
    setIsRunning(false)
    // POST to /pace-log with elapsedMinutes + pagesRead
    await fetch('/api/pace-log', {
      method: 'POST',
      body: JSON.stringify({ userId, bookId, pagesRead: Number(pagesRead), durationMinutes: elapsedMinutes })
    })
  }

  return (
    <div className="p-4 border rounded-xl">
      <p className="text-2xl font-mono">{elapsedMinutes} min</p>
      {!isRunning
        ? <button onClick={handleStart}>Start Reading</button>
        : (
          <div>
            <input
              type="number"
              placeholder="Pages read"
              value={pagesRead}
              onChange={e => setPagesRead(e.target.value)}
            />
            <button onClick={handleStop}>Stop & Save</button>
          </div>
        )
      }
    </div>
  )
}
```

---

## 10. Phase-by-Phase Roadmap

### Phase 1 — Vision Pipeline (Week 1)
**Goal:** Upload photo → see extracted book titles

- [ ] Set up AWS account, enable billing alert at $5
- [ ] Create S3 bucket `shelfscannerai-images-dev`
- [ ] Create Lambda function `upload-handler` (Python 3.12)
- [ ] Wire S3 upload → Rekognition `DetectText`
- [ ] Build title cleaning/deduplication logic
- [ ] Integrate Open Library API for title enrichment
- [ ] Scaffold Next.js project with `ImageUploader` component
- [ ] Wire frontend upload → API Gateway → Lambda
- [ ] Test with 20+ real bookshelf photos
- [ ] **Metric to capture:** Title extraction accuracy % (matched vs. unmatched)

**Definition of done:** Upload a photo of 10 book spines, see 8+ correct titles returned.

---

### Phase 2 — User Memory Layer (Week 2)
**Goal:** Users have profiles; reading history is persisted

- [ ] Create DynamoDB tables: `Users`, `Books`, `ReadingHistory`
- [ ] Build user creation flow (simple UUID for now, Cognito later)
- [ ] Build `GET /user/{userId}/profile` Lambda
- [ ] Build manual "add book to history" flow (for initial seeding)
- [ ] Build `POST /feedback` Lambda
- [ ] Wire feedback → Bedrock signal extractor prompt
- [ ] Store extracted signals back to `ReadingHistory`
- [ ] Update `Users.tasteProfile` based on extracted signals
- [ ] Display taste profile on frontend profile page

**Definition of done:** Add 3 books with feedback, see taste profile auto-update with extracted preferences.

---

### Phase 3 — Recommendation Engine (Week 3)
**Goal:** Scan shelf → get personalized AI recommendations with reasoning

- [ ] Create `recommend-handler` Lambda
- [ ] Build Bedrock recommendation prompt (see Section 8)
- [ ] Wire: titles + taste profile + pace → Bedrock → ranked output
- [ ] Build `RecommendationList` + `BookCard` frontend components
- [ ] Display reasoning per book (expandable)
- [ ] Store scan session to `ScanSessions` table
- [ ] Add `extractionAccuracy` and `processingTimeMs` to session log
- [ ] Test with 5+ different user profiles

**Definition of done:** Scan a shelf of 8 books, get 3 ranked recommendations each with specific, personalized reasoning that references the user's actual reading history.

---

### Phase 4 — Reading Pace + Polish (Week 4)
**Goal:** Pace tracking works; project is live and demo-ready

- [ ] Create `PaceSessions` DynamoDB table
- [ ] Build `pace-handler` Lambda with rolling average calculation
- [ ] Build `PaceTimer` frontend component
- [ ] Wire pace data into Bedrock recommendation prompt
- [ ] Show "estimated completion time" per recommended book
- [ ] Add pace stats to profile page (chart with Recharts)
- [ ] Deploy frontend to Vercel or AWS Amplify
- [ ] Record demo video (phone scanning a real bookshelf)
- [ ] Write README with architecture diagram
- [ ] Capture all metrics for resume bullets

**Definition of done:** Full end-to-end flow works live on a real URL. Demo video recorded.

---

## 11. Pending Tasks Checklist

### Infrastructure Setup
- [ ] Create AWS account → set $5 billing alert immediately
- [ ] Create IAM role for Lambda with least-privilege permissions:
  - `s3:PutObject` on `shelfscannerai-images-*`
  - `rekognition:DetectText`
  - `bedrock:InvokeModel` on `anthropic.claude-sonnet-4-6`
  - `dynamodb:GetItem`, `PutItem`, `UpdateItem`, `Query` on all tables
- [ ] Enable Bedrock model access in AWS console (us-east-1)
- [ ] Create API Gateway REST API with `/upload`, `/recommend`, `/feedback`, `/pace-log` routes
- [ ] Set API Gateway timeouts to 29s (Lambda max is 30s)
- [ ] Enable CloudWatch logs on all Lambda functions

### Backend
- [ ] `upload-handler` Lambda — S3 upload + Rekognition + Open Library enrichment
- [ ] `recommend-handler` Lambda — taste profile fetch + Bedrock call + session log
- [ ] `feedback-handler` Lambda — Bedrock signal extraction + profile update
- [ ] `pace-handler` Lambda — session log + rolling average calculation
- [ ] Error handling: Rekognition finds 0 titles → graceful fallback message
- [ ] Cold start optimization: keep Lambda warm for demo (EventBridge ping every 5 min)
- [ ] Input validation on all endpoints

### Frontend
- [ ] Next.js project scaffold with Tailwind
- [ ] `ImageUploader` — camera capture + file upload + base64 conversion
- [ ] `RecommendationList` + `BookCard` with expandable reasoning
- [ ] `FeedbackForm` — star rating + text input
- [ ] `PaceTimer` — start/stop + page input
- [ ] `TasteProfileWidget` — visual display of current profile
- [ ] Loading states for all async operations (Bedrock can take 3-8s)
- [ ] Mobile-responsive layout (primary use case is in-store on phone)

### Testing & Metrics
- [ ] Collect 50+ test bookshelf photos across lighting conditions
- [ ] Measure and document extraction accuracy → **target: >85%**
- [ ] Measure and document end-to-end recommendation latency → **target: <8s**
- [ ] Test Bedrock reasoning quality across 5 different taste profiles
- [ ] Document all metrics — these go directly on resume

### Deployment
- [ ] Deploy frontend to Vercel (simplest) or AWS Amplify
- [ ] Set up custom domain (optional but professional)
- [ ] Record 90-second demo video — real phone, real bookshelf, real library
- [ ] Write GitHub README with architecture diagram, demo GIF, setup instructions

---

## 12. Resume Bullet Targets

Fill in the `[X]` values after measuring during Phase 4. These are the target resume bullets:

```
ShelfScannerAI | AWS Lambda, Rekognition, Bedrock (Claude), DynamoDB, S3, Next.js

• Built a serverless AWS reading companion agent that converts bookshelf photos 
  into personalized book recommendations using Amazon Rekognition DetectText 
  ([X]% title extraction accuracy across [50+] test images) and Amazon Bedrock 
  for taste-aware reasoning with explainable author writing style comparisons.

• Designed a persistent user memory architecture in DynamoDB that tracks reading 
  history, natural-language post-read feedback, and author style signals — 
  automatically updating a taste profile via Bedrock-powered signal extraction 
  after every book finished.

• Engineered a reading pace model that computes rolling pages/hour averages from 
  session timer logs and factors estimated completion time into book ranking — 
  a capability absent from Goodreads and all major reading tracker platforms.

• Architected a fully serverless event-driven pipeline: API Gateway → Lambda → 
  S3 → Rekognition → Bedrock with end-to-end recommendation latency of <[X]s, 
  designed with IAM least-privilege access and CloudWatch observability.
```

---

## 13. Cost & Free Tier Guide

| Service | Free Tier | Expected Dev Usage | Est. Monthly Cost |
|---|---|---|---|
| Rekognition DetectText | 5,000 images/month (12 mo) | ~200 images | $0 |
| S3 | 5 GB always free | < 1 GB | $0 |
| Lambda | 1M requests always free | ~500 requests | $0 |
| API Gateway | 1M calls/month (12 mo) | ~500 calls | $0 |
| DynamoDB | 25 GB always free | < 100 MB | $0 |
| Bedrock (Claude Sonnet) | No free tier | ~100 calls × $0.01 | ~$1–3 |
| **Total** | | | **~$1–3/month** |

**Critical:** Set a CloudWatch billing alarm at $5 immediately after account creation. Bedrock is the only real cost driver at portfolio scale.

---

## 14. Environment Variables

```bash
# AWS
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_key          # Use IAM role in Lambda — only for local dev
AWS_SECRET_ACCESS_KEY=your_secret   # Use IAM role in Lambda — only for local dev

# S3
S3_BUCKET_NAME=shelfscannerai-images-dev

# DynamoDB Table Names
DYNAMODB_USERS_TABLE=Users
DYNAMODB_BOOKS_TABLE=Books
DYNAMODB_HISTORY_TABLE=ReadingHistory
DYNAMODB_SESSIONS_TABLE=ScanSessions
DYNAMODB_PACE_TABLE=PaceSessions

# Bedrock
BEDROCK_MODEL_ID=anthropic.claude-sonnet-4-6
BEDROCK_REGION=us-east-1

# Open Library (no key needed — just base URL)
OPEN_LIBRARY_BASE_URL=https://openlibrary.org

# Frontend (Next.js)
NEXT_PUBLIC_API_BASE_URL=https://{api-id}.execute-api.us-east-1.amazonaws.com/prod
```

---

## Quick Reference — Key Decisions Made

| Decision | Choice | Reason |
|---|---|---|
| Vision service | Rekognition DetectText | Free tier, AWS-native, no model training needed |
| LLM | Bedrock Claude Sonnet | Best reasoning quality, AWS-native, resume-relevant |
| Database | DynamoDB | Always-free tier, AWS-native, fits access patterns |
| Compute | Lambda (serverless) | Zero idle cost, AWS-native, scales automatically |
| Frontend | Next.js + Vercel | Fast deploy, React ecosystem, mobile-responsive |
| Auth | UUID now → Cognito in v2 | Keep scope focused for portfolio; Cognito is upgrade path |
| Book metadata | Open Library API | Completely free, no rate limit issues at portfolio scale |
| Image storage | S3 + 7-day TTL | Cost control; raw images aren't needed long-term |

---

## 15. Addendum — Phase 2 Vector Layer (added September 2026)

This section adds to Phase 2 without changing anything in sections 1–14. Everything above — DynamoDB tables, API design, Bedrock prompts, frontend structure, phase roadmap — remains as originally written.

### 15.1 Why this was added

The resume bullet for this project already claims a RAG architecture: Amazon Titan Embeddings, cosine similarity search across reading-history embeddings, and Amazon Bedrock (Claude) for explainable ranking, on top of pgvector on AWS RDS. This addendum makes that real rather than aspirational, folded into Phase 2's `POST /feedback` path. The actual cosine-similarity retrieval + ranking logic (querying `book_embeddings` before calling Bedrock to rank) is Phase 3 (`recommend-handler`) and is **not** built yet — this addendum only gets the storage layer and the embedding-on-feedback write path in place.

### 15.2 New component: `book_embeddings` on Aurora Serverless v2 (pgvector)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE book_embeddings (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       TEXT NOT NULL,
    book_id       TEXT NOT NULL,
    title         TEXT,
    author        TEXT,
    rating        INTEGER,
    embedding     vector(1024),
    embedded_at   TIMESTAMP,
    UNIQUE (user_id, book_id)
);
```

**Corrected from the originally-specified 1,536 dimensions** after live-testing against the real Bedrock API (2026-11-12): `amazon.titan-embed-text-v2:0` only accepts `dimensions` of 256, 512, or 1024 — 1536 is an OpenAI (`text-embedding-ada-002`) convention, not a Titan one, and the API rejects it. Both the SQL column and the `_embed_text` call in `feedback_handler/app.py` use 1024.

The `UNIQUE (user_id, book_id)` constraint isn't in the originally-specified schema — it was added so `feedback_handler` can `INSERT ... ON CONFLICT (user_id, book_id) DO UPDATE ...` (re-reading the same book updates its embedding rather than duplicating rows).

The RDS Data API has no native `vector` parameter type. Embeddings are passed as a string literal (`"[0.01,0.02,...]"`) and cast in SQL with `::vector` / `CAST(... AS vector)`.

`CREATE EXTENSION` and `CREATE TABLE` can't be expressed declaratively in CloudFormation, so they run once via a `Custom::AuroraBootstrap` CloudFormation custom resource (`backend/db_bootstrap/app.py`) that calls the Data API directly at deploy time.

### 15.3 Why Aurora Serverless v2 + RDS Data API (not plain RDS Postgres)

Lambda can only reach an RDS/Aurora database over the network if it's VPC-attached, and a VPC-attached Lambda loses default internet access — breaking its calls to Bedrock, Rekognition, and Open Library (a public third-party API with no AWS VPC endpoint) unless a NAT Gateway is added (~$32–38/month fixed). The RDS Data API sidesteps this entirely: it's an HTTPS API in front of the database, so Lambda calls it like any other AWS API with no VPC networking of its own. Aurora Serverless v2 is the engine that supports the Data API with pgvector.

**The real cost tradeoff (confirmed, not templated around):** Aurora Serverless v2 added true scale-to-zero (0 ACU) in Nov 2024, but AWS CloudFormation's `AWS::RDS::DBCluster` resource has never been updated to allow `MinCapacity: 0` — it's AWS CLI-only, a known, unresolved CloudFormation gap. Since this project deploys via SAM (CloudFormation), the cluster is floored at `MinCapacity: 0.5` ACU, which runs **~$43.80/month if left running continuously** — more than the NAT Gateway this design avoided. This is a conscious, accepted tradeoff: manage cost by running `aws rds stop-db-cluster` between work sessions. Note AWS auto-restarts a stopped cluster after 7 days regardless, so this is a recurring habit, not a one-time setting — and remember to `aws rds start-db-cluster` before testing `/feedback` or anything that hits the Data API, since Data API does not auto-start a fully-stopped cluster (only auto-resume one that's merely idle at low ACU).

*Optional future improvement, not built:* an EventBridge Scheduler rule + a small Lambda calling `rds:StopDBCluster` on a nightly schedule, to remove the reliance on remembering to do this manually.

### 15.4 Updated Lambda responsibilities

`POST /feedback` (`backend/feedback_handler/app.py`) now, in addition to the Prompt 2 signal extraction described in section 8:
1. Embeds `"{title} by {author}. Reader feedback: {feedbackText}"` via Titan Embeddings (`amazon.titan-embed-text-v2:0`, 1024 dimensions — see the correction note in 15.2).
2. Upserts the resulting vector into `book_embeddings` via the RDS Data API.

**Also corrected after live-testing (2026-11-12): the Claude model ID.** Section 5/8/11/14 above refer to `anthropic.claude-sonnet-4-6` as a bare model ID; as of this account's Bedrock access, on-demand `InvokeModel` against that bare ID is rejected — Bedrock now requires invoking Claude Sonnet 4.6 via a cross-region **inference profile** instead. `feedback_handler`'s `BEDROCK_CLAUDE_MODEL_ID` is set to `us.anthropic.claude-sonnet-4-6`, and its IAM policy grants `bedrock:InvokeModel` on both the inference-profile ARN and the underlying foundation-model ARN in each region the "us." profile can route to (`us-east-1`, `us-east-2`, `us-west-2`) — cross-region profiles require both per AWS's documented IAM pattern. Titan Embeddings has no such requirement; it's invoked directly by its foundation-model ID as originally planned.

`GET /user/{userId}/profile` (`backend/user_handler/app.py`) is unchanged from the original Phase 2 spec in section 7 — no vector-layer involvement.

A `bookId` continuity note: `upload_handler` (Phase 1) doesn't return a `bookId` today, since Open Library's `search.json` doesn't reliably surface ISBNs. `feedback_handler` accepts optional `title`/`author`/`genres` fallback fields in its request body and best-effort caches them into `Books` on a cache miss, so the `Books` cache starts filling in from feedback alone. Revisit if/when `upload_handler` starts writing real `bookId`s.

`ReadingHistory`'s sort key is implemented as a plain attribute named `sk` holding the value `"{bookId}#{readAt}"` — a conventional attribute name, not a literal `#` character inside an attribute name, slightly reinterpreting section 6's `bookId#readAt (SK)` notation.

### 15.5 Updated IAM

In addition to the IAM list in the Pending Tasks Checklist (section 11):
- `bedrock:InvokeModel` on `amazon.titan-embed-text-v2:0` (in addition to the existing Claude Sonnet model).
- `rds-data:ExecuteStatement`, `rds-data:BatchExecuteStatement`, `rds-data:BeginTransaction`, `rds-data:CommitTransaction`, `rds-data:RollbackTransaction` on the Aurora cluster ARN.
- `secretsmanager:GetSecretValue` on the Aurora cluster's RDS-managed master-user secret ARN (Data API authenticates via this secret, not IAM DB auth).

### 15.6 What's ready for Phase 3, not built yet

`book_embeddings` is schema-ready for `recommend-handler` to query via the pgvector `<=>` cosine-distance operator (`ORDER BY embedding <=> :query_embedding LIMIT N`) before passing top matches to Bedrock for ranking, per the original Phase 3 plan in section 10. That retrieval + ranking logic itself is not implemented as part of this addendum.

---

## 16. Addendum — Phase 3 Recommendation Engine (added November 2026)

This section adds to Phase 3 without changing anything in sections 1–15. Deployed and live-verified end-to-end on 2026-11-13, including the real bugs below that only surfaced against live AWS.

### 16.1 Why this shape

The core recommendation flow is scan-anchored, not a general browse: titles extracted from a bookshelf photo (`/upload`'s output) are the candidate pool, ranked against the reader's own taste signal. The twist beyond the original section 10 plan is cold-start handling — a brand-new user has no `book_embeddings` yet, so there's nothing to compare candidates against. Rather than fail or give generic advice, a new onboarding step captures stated preferences, and a curated ~450-book catalog (`catalog_embeddings`, populated by a one-time ingestion script) stands in for history until the user has read and rated books of their own. A user "graduates" from cold-start to established automatically the moment `feedback_handler` writes their first `book_embeddings` row — no special-case code needed, `/recommend` just checks `count(*) FROM book_embeddings WHERE user_id = ...` on every call.

The catalog is deliberately small (445 books ingested from 9 Open Library subjects, not a bulk dump of thousands) — better embedding quality from real descriptions beats sprawling thin-metadata coverage, and no pgvector index was added on either `book_embeddings` or `catalog_embeddings` (a sequential scan at hundreds of rows is sub-millisecond; an approximate index would only reduce accuracy for no latency benefit at this scale).

### 16.2 New component: `catalog_embeddings`

```sql
CREATE TABLE catalog_embeddings (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_key     TEXT NOT NULL,
    title        TEXT NOT NULL,
    author       TEXT,
    subjects     TEXT,
    description  TEXT,
    embedding    vector(1024),
    ingested_at  TIMESTAMP,
    UNIQUE (work_key)
);
```

**Corrected from the originally-planned `subjects TEXT[]`** after live-testing: the RDS Data API's `execute_statement` rejects array-type parameters outright (`ValidationException: Array parameters are not supported`) — this is a hard limitation of the Data API itself, not something fixable with different parameter formatting. `subjects` is stored as a JSON-encoded string instead; nothing queries or filters on it, so the richer `TEXT[]` type bought nothing in practice.

Populated by `backend/scripts/ingest_catalog.py` — a standalone script (not a Lambda/custom resource; ~450 sequential books each needing an Open Library call + Titan embed + Data API insert risks Lambda's 15-minute cap and is painful to resume mid-failure as a CFN custom resource). Pulls from Open Library's bulk **subjects** endpoint (`openlibrary.org/subjects/{subject}.json`, distinct from the per-title `search.json` `upload_handler` uses), across `fiction`, `mystery_and_detective_stories`, `science_fiction`, `fantasy`, `romance`, `historical_fiction`, `horror`, `biography`, `young_adult_fiction` at 60 each. Safely re-runnable — it queries existing `work_key`s before spending any Bedrock call. Run manually:
```
AURORA_CLUSTER_ARN=... AURORA_SECRET_ARN=... AURORA_DATABASE_NAME=shelfscanner AWS_REGION=us-east-1 \
python backend/scripts/ingest_catalog.py
```
(Aurora must be running first — `aws rds start-db-cluster` if stopped.)

### 16.3 Real bugs found via live testing (none caught by `sam validate`/`sam build`/local testing)

1. **CloudFormation custom resources don't re-run just because the backing Lambda's code changed.** `AuroraBootstrap` kept its old `Properties` (`ServiceToken`, `ClusterArn`) unchanged between the Phase 2 and Phase 3 deploys, so CloudFormation saw "nothing to update" and skipped re-invoking `db_bootstrap`'s new `catalog_embeddings` SQL entirely — the table didn't exist after the first Phase 3 deploy despite a clean `UPDATE_COMPLETE`. Fixed by adding a manually-bumped `BootstrapSqlVersion` property to the custom resource; **bump this every time `BOOTSTRAP_SQL` in `db_bootstrap/app.py` changes**, or the new SQL silently won't run.
2. **RDS Data API's `execute_statement` does not support array parameters** (see 16.2) — breaks on the first `TEXT[]` insert, not at template-deploy time.
3. **DynamoDB's boto3 resource API rejects native Python `float`** (`TypeError: Float types are not supported. Use Decimal types instead.`) — hit writing `matchScore`/`distance` values (sourced as Python floats from the Data API's `doubleValue` and from embedding-similarity math) into `ScanSessions`. Fixed with a small `_dynamo_safe()` helper in `recommend_handler/app.py` that round-trips a value through `json.dumps`/`json.loads(..., parse_float=Decimal)` to recursively convert any nested floats before a `put_item` call. Apply this to any future DynamoDB write that might carry a `float` anywhere in its structure, not just top-level.
4. **Missing IAM permission**: the onboarding route added `dynamodb:UpdateItem` usage to `user_handler`, but `UserProfileHandlerFunction`'s policy only granted `GetItem`/`PutItem` — caught immediately by a live `AccessDeniedException`, not by any local check. Whenever a Lambda's code gains a new DynamoDB/AWS API call, grep the function body for the actions actually used and cross-check against its SAM `Policies` block before deploying, since nothing local catches a mismatch.
5. **Windows console default encoding (`cp1252`) crashes on non-ASCII book titles.** `ingest_catalog.py` iterates over worldwide literature from Open Library and will hit titles with characters outside cp1252's range. Fixed with `sys.stdout.reconfigure(encoding="utf-8", errors="replace")` near the top of the script — needed for any script in this project that prints external, uncontrolled text on Windows.

### 16.4 `/recommend` — request shape deviates from section 7

The original spec in section 7 takes `titles: string[]`. The implementation instead takes `candidates: [{title, author, pageCount, genres}]` — exactly the shape `/upload` already returns. Re-deriving author/genres from a bare title string would mean a second, redundant Open Library round trip; reusing `/upload`'s already-enriched output is strictly better and keeps the two endpoints composable.

```json
POST /recommend
{
  "userId": "user_abc123",
  "sessionId": "sess_xyz789",
  "candidates": [{"title": "The Secret History", "author": "Donna Tartt", "pageCount": 559, "genres": ["literary fiction"]}],
  "constraints": {"mood": "something atmospheric"}
}
```
Response adds a top-level `"mode": "established" | "cold_start"` (which table/branch supplied the similarity signal) and a per-recommendation `"similarTo": {title, author, distance}` showing the specific nearest-neighbor match Claude's reasoning is grounded in. Claude's output is never trusted blind — recommendations are filtered to only titles that were actually in the request (case-insensitive match), and `similarTo` is re-attached server-side from the computed nearest-match data rather than trusting Claude to echo it back correctly.

Cosine distance → `matchScore`: since Titan embeddings are generated with `normalize: True`, `pgvector`'s `<=>` operator returns `1 - cosine_similarity`, so `matchScore = max(0, 1 - distance)`.

Live-timed latency (relevant since API Gateway has a hard 29s ceiling): 3 candidates ≈ 11s, 8 candidates ≈ 19s. N candidates means N sequential Titan-embed + Data-API round trips before Claude even runs, so latency scales with scan size — no candidate-count capping needed at the scales tested, but worth re-timing if scans regularly exceed ~10 books.

### 16.5 Onboarding — `POST /user/{userId}/onboarding`

Added as a second route on the existing `UserProfileHandlerFunction` (branching inside `lambda_handler` on `event.get("httpMethod")`), not a new Lambda — same table, same resource, avoids a 6th Lambda for one write path.

```json
POST /user/{userId}/onboarding
{"favoriteAuthors": ["..."], "favoriteGenres": ["..."], "writingStylePrefs": ["..."], "avoidThemes": ["..."], "preferredPacing": "...", "preferredLength": "..."}
```
Overwrite semantics on the fields provided (not `feedback_handler`'s dedupe-append) — onboarding is an explicit form submission, not an inferred signal. Frontend gates this behind a simple check: show `OnboardingForm` on the profile page when `totalBooksRead === 0` and every taste-profile list field is empty.

### 16.6 `ScanSessionsTable`

PK `sessionId` only, no GSI on `userId` — nothing in the frontend queries "all scans by a user" yet (the profile page's recent-books list comes from `ReadingHistory`, not `ScanSessions`). Deferred, not built speculatively; add one if/when something actually needs that access pattern.

### 16.7 Updated IAM

`RecommendHandlerFunction` mirrors `FeedbackHandlerFunction`'s existing Bedrock/Data-API policy block exactly, plus `GetItem`/`PutItem` on `UsersTable` and `PutItem` on `ScanSessionsTable`. `UserProfileHandlerFunction` gained `dynamodb:UpdateItem` on `UsersTable` for the onboarding route (see 16.3.4).

### 16.8 What's still deferred

Phase 4 (reading pace tracking) — untouched. `upload_handler` still doesn't return stable `bookId`s for scanned titles — `/recommend` works around this by embedding title+author+genres directly rather than needing a `bookId` key, same workaround `feedback_handler` already uses. The frontend is not yet deployed publicly (Vercel/Amplify) — still local-only as of this addendum.

### 16.9 Phase 3.1 — personalized cold-start subset + preference/novelty toggle (added November 2026)

Two refinements on top of 16.1-16.8, live-verified 2026-11-14:

**Preference-matched catalog subset.** Previously, a cold-start user's candidates were compared against the entire 445-book catalog regardless of their onboarding preferences — personalization only happened inside Claude's prose, not the retrieval math. Now, if a cold-start user has any onboarding preferences (`_has_preferences`), their `favoriteAuthors`/`favoriteGenres`/`writingStylePrefs` get combined into one text blob, embedded once, and used to pull a 15-book "proxy history" subset from `catalog_embeddings` (`_catalog_proxy_work_keys`). Candidates are then compared only against that subset, not the whole catalog (`_nearest_catalog_matches(..., work_keys=proxy_work_keys)`) — the `IN` clause uses individually-named placeholders (`:key0, :key1, ...`), not an array parameter, per the Data API limitation in 16.3.2. A cold-start user with zero onboarding data still falls back to whole-catalog search, unchanged.

**`explorationMode: "preference" | "novelty"`.** New optional `/recommend` request field (default `"preference"`). Before anything else, candidates are hard-filtered against `tasteProfile.dislikedGenres` — unconditionally, in both modes, and before any embedding calls to avoid spending on genres that would be rejected anyway (`_filter_disliked_genres`). If this empties the candidate list, the Lambda returns an empty-recommendations response directly without calling Claude. The actual similarity retrieval (nearest-3, ascending distance) is unchanged regardless of mode — what changes is the sort order candidates are presented to Claude in (ascending/closest-first for `"preference"`, descending/farthest-first for `"novelty"`) and an explicit `MODE_INSTRUCTIONS` paragraph interpolated into the prompt, so Claude's reasoning is genuinely mode-aware (confirmed live: novelty-mode reasoning explicitly frames picks as "a genuine stretch" rather than a close match). `avoidThemes` is restated as a hard instruction in the prompt regardless of mode. Both `mode` and `explorationMode` are now recorded on the `ScanSessions` row.

## 17. Addendum — OCR noise consolidation fix (added November 2026)

### 17.1 The problem

A dense real-world test (16 physical books, stacked spines) surfaced a real precision problem in `upload_handler` that a synthetic 3-line test image never exposed: Rekognition detects every line of text on a spine, not just the title — author names printed separately, marketing blurbs ("#1 New York Times bestseller"), publisher/imprint names ("Vintage", "Folger"), honorifics ("His Divine Grace"), subtitles, and ISBN/barcode text all come back as separate high-confidence `LINE` detections. The original pipeline treated every single line as a candidate title and searched it against Open Library's fuzzy `search.json`, which always returns *some* best-effort match with no quality gate — so garbage fragments like "Clear" (from "James Clear") or "Folger" (a publisher imprint) confidently matched unrelated real books ("Clear and Present Danger," "The Folger Way"). Of 38 "titles" extracted from 16 real books in testing, only about 7 were actually correct — roughly 18% precision. Rekognition's reported confidence score is confidence in reading the text correctly, not confidence that the resulting book match is correct, which made the bad matches look deceptively trustworthy in the UI.

### 17.2 The fix

A new LLM consolidation step between Rekognition and Open Library: all raw OCR lines (original casing preserved — `extract_lines` no longer forces Title Case, since casing is itself a signal for the LLM) are sent in one batch to `consolidate_titles()`, which prompts a cheap, fast model to group fragments into actual title/author pairs and discard everything else (marketing copy, imprints, honorifics, barcodes), returning which exact source fragments it used for each book. Only the consolidated titles get searched against Open Library — not every raw line.

**Model choice, verified live before committing:** `amazon.titan-embed-text-v2:0`-adjacent reasoning isn't needed here — this is a text-classification task, not complex reasoning, so a cheap/fast model is the right fit rather than paying Sonnet's latency and cost for every upload. `us.anthropic.claude-haiku-5-5` is **not available on this account** (`AccessDeniedException`, same restriction as "Claude Sonnet 5" encountered in section 15 — newer/premium model tiers need separate access). `us.anthropic.claude-haiku-4-5-20251001-v1:0` works and is what's deployed. IAM mirrors the inference-profile + underlying-foundation-model pattern established for Sonnet (profile ARN plus the model ARN across `us-east-1`/`us-east-2`/`us-west-2`).

**Known limitation:** when one author's name appears near multiple books by that author (e.g. several books by the same author stacked together, with the author's name OCR'd only once), the consolidation model can conservatively group the author with only one of the books and silently drop the other rather than guess at an ambiguous pairing — favoring precision over recall. Confirmed in testing: a stack containing both "Krsna" and "Bhagavad Gita As It Is" by the same author, with the author's name detected once, resulted in only one of the two being returned. Not fixed as part of this addendum — a future improvement could use Rekognition's bounding-box geometry to spatially associate fragments by proximity before the LLM step, rather than relying on the LLM to resolve ambiguity from text alone.

### 17.3 Adaptive image slicing — Rekognition's 100-word-per-call cap (added November 2026)

**A second, independent problem surfaced on the same dense real-world test** (16 physical books): `DetectText` has a hard, undocumented-in-the-response cap of **100 words per API call** (per [AWS's own quota documentation](https://docs.aws.amazon.com/rekognition/latest/dg/limits.html) — there is no explicit "truncated: true" flag, the response just silently stops at 100). A 16-book stack, each spine carrying several words of title/author/publisher text, exceeds this easily — confirmed by books from both the top and bottom of a real test stack being completely absent from results even after the 17.2 consolidation fix.

**Fix:** `upload_handler/app.py` no longer makes a single `DetectText` call on the whole image. `extract_lines()` now calls a new recursive `_detect_text_region()`: it crops the image to a given vertical fraction (via Pillow), calls `DetectText` on just that crop (`Image={"Bytes": ...}`, not an S3 reference — simpler, and avoids a second S3 round trip for the slice), and counts `WORD`-type detections (not `LINE` — the 100-word cap is on words specifically). If the count is at or near the cap (`WORD_SATURATION_THRESHOLD = 95`, kept a margin below 100), the region is probably truncated, so it's split into two **overlapping** halves (`OVERLAP_FRACTION = 0.08` of the region height extends into each neighbor, so a line of text that would be cut by a clean boundary cut usually falls entirely within at least one half) and each half is recursed into independently, up to `MAX_SPLIT_DEPTH = 3` levels or until a region's pixel height drops below `MIN_SLICE_HEIGHT_PX`. All lines collected across every region at every depth — including the (possibly partial) lines from a region that triggered a further split, kept as a cheap safety net — are merged and deduplicated exactly as before. **This adapts to the actual photo's density rather than assuming a fixed number of books fit in frame**: a simple 5-book photo makes exactly one `DetectText` call (no slicing triggered), while a dense stack recurses as many times as it actually needs. The LLM consolidation step downstream (17.2) is completely unaware this happened — it only ever sees one flat, deduplicated list of text fragments, same as before.

**Dependency note:** cropping requires Pillow, which has a compiled C extension — installing it locally on this Windows dev machine (no Docker available for `sam build --use-container`) would bundle Windows binaries incompatible with Lambda's Linux runtime. Used a public, pre-built Lambda Layer instead (the Klayers project, `arn:aws:lambda:us-east-1:770693421928:layer:Klayers-p312-pillow:2`, Pillow 11.0.0 for Python 3.12) — verified it actually exists via `aws lambda get-layer-version` before adding it to `UploadHandlerFunction`'s `Layers` property, rather than trusting a search result. **If this project is ever deployed to a different region, this layer ARN (region-specific) needs updating or re-publishing** — Klayers publishes per-region, and this one is hardcoded to `us-east-1`.

**Live-verified result:** on the same 16-book test photo, extraction went from 7 correct titles (section 17.1's starting point after the LLM consolidation fix alone) to **13 correct titles, zero false positives** — recovering books from both the very top and very bottom of the stack that no single-call approach could reach. Processing time increased from ~4-6s to ~17s on this dense a photo (more `DetectText` calls), still comfortably inside the 29s API Gateway ceiling.

### 17.4 Root-cause investigation and consolidation-prompt improvements (added November 2026)

Rather than continue to speculate about the 3 remaining misses from 17.3, temporary diagnostic logging (`print()` of the raw deduplicated OCR lines and the raw consolidation output, since removed) was added and the exact same real photo was re-run to get ground-truth evidence:

- **"Krsna" was read perfectly cleanly by Rekognition** — it appears as its own crisp fragment in the raw line list. The miss happens entirely at the consolidation (LLM) step: this spine's honorific/publisher text ("His Divine Grace" appearing 3 times with different casing, "The Supreme Personality of Godhead", "The Bhaktivedanta", "Book Trust") sits in a cluttered cluster shared with the *adjacent* Prabhupada book, and the model conservatively builds one confident, well-evidenced entry (*Bhagavad-Gita As It Is*) rather than also inventing a second one for the bare word "Krsna" alone. **This is not an OCR/image-quality problem — the data was there.**
- **"A Knight of the Seven Kingdoms" OCR'd into 5 separate fragments** instead of the clean 1-2 other titles got (narrower spine → more word-wrapping), and the consolidation step failed to reassemble that many scattered pieces amid several near-identical "George R.R. Martin" fragments from sibling books.
- **The "A Dance with Dragons" duplicate-title collapse had a root cause the raw data actually contradicted**: distinct volume markers ("1: Dreams and Dust", "2: After the Feast") were present in the OCR output the whole time — the consolidation prompt simply never instructed the model to treat a part/volume marker next to an otherwise-identical title as evidence of two separate physical books.

**Fix attempted and partially successful:** `CONSOLIDATION_SYSTEM_PROMPT` gained two explicit instructions: (1) multiple books by the same author are common, and an author fragment should be reused across several distinct titles rather than "used up" by one; (2) a part/volume/subtitle marker next to an otherwise-identical title means two separate books, and the marker should be appended to the title so they stay distinguishable (e.g. "A Dance with Dragons: 1: Dreams and Dust").

- **The volume-marker instruction worked outright**, confirmed against the exact captured real data before redeploying: both *A Dance with Dragons* and (an undetected-until-now) *A Storm of Swords* two-volume pattern now split correctly, each enriched by Open Library into a more precise match (e.g. "A History of the Crusades, Vol. 1", "A Storm of Swords, Part 2: Blood and Gold") rather than a generic fallback.
- **The same-author-reuse instruction did not flip the two hardest cases** ("Krsna", "A Knight of the Seven Kingdoms") in live testing. Both remain genuinely ambiguous judgment calls for a text-only consolidation step (a bare single word with no cleanly-attached author nearby; a title fragmented into too many disjoint pieces to confidently reassemble). Pushing the prompt further to accept more ambiguous bare words as titles was deliberately not attempted — that trades back toward the original bug this whole fix exists to prevent (treating stray fragments as real titles).
- **Live result after both prompt changes is 14-15 of 16 (not a fixed number)** — re-running the identical photo twice in a row produced 15 titles once and 14 the next time, with the *Storm of Swords* volume-split specifically landing differently each run (sometimes both volumes, sometimes only one). This is normal LLM sampling variance on the hardest disambiguation case, not a regression — removing the temporary diagnostic logging between runs had no effect on this. **Exact determinism is not achievable with this architecture**; 14-15/16 live (87-94%) with zero false positives either way is the realistic, accepted outcome of the text-only consolidation approach, up from the original ~18% precision this section started with.

---

*Handoff prepared July 2026. All architecture decisions, schema, and prompts are ready for implementation. Start with Phase 1 — vision pipeline — and validate extraction accuracy before building the recommendation layer.*
