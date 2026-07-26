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

*Handoff prepared July 2026. All architecture decisions, schema, and prompts are ready for implementation. Start with Phase 1 — vision pipeline — and validate extraction accuracy before building the recommendation layer.*
