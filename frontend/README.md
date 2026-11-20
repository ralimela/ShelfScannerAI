# ShelfScannerAI — Frontend

Next.js 16 (App Router) app, built as a fully static export and hosted on AWS Amplify Hosting. See the [root README](../README.md) for the full project overview, architecture, and backend setup.

```bash
npm install
cp .env.example .env.local   # values come from the backend stack outputs
npm run dev                  # http://localhost:3000
npm test                     # Jest + React Testing Library
npm run build                # static site in out/
```

`next build` writes the whole site to `out/` (`output: "export"` in `next.config.ts`), so deploying is just uploading that folder. `NEXT_PUBLIC_*` values are compiled into the JavaScript at build time, so pointing the app at a different backend means rebuilding.
