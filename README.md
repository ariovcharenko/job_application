# Job Copilot

Check if a tech job fits you, tailor your resume from your real experience, and track applications.
Runs in your browser with your own Claude API key. There is no backend: your data lives in your
browser's IndexedDB, and AI calls go straight from your browser to Anthropic. See `/privacy` in the
app for exactly what is sent where.

Try `/example` first: a sample job and candidate, checked by the real code, with no key needed.

## What you need

- A recent Chrome, Edge, Safari or Firefox. (The optional resume-folder feature needs Chrome or Edge.)
- An [Anthropic API key](https://console.anthropic.com/settings/keys) with at least $5 of credit.
  Set a monthly spend limit on it. Costs: about 1 to 2¢ to check a job, about 5¢ to tailor a resume.

## Running locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. A fresh browser shows a setup card; `/onboarding` walks through the
key, your experience (import it from your resume), your Profile and what you're looking for.

## Moving your data

Everything is stored per browser and per site. To move (for example from localhost to the deployed
site): Settings, Backup and restore, **Download backup** on the old one, then **Restore from backup**
on the new one. A backup holds everything (settings, Profile, preferences, experience, saved answers,
jobs, tailored resumes, contacts). The API key is left out unless you tick the box.
**Delete all my data** in the same card wipes this browser's copy.

## Testing

```bash
npm test           # Vitest (node + fake-indexeddb)
npm run typecheck  # tsc --noEmit
```

## Deploying

A static, client-only Next.js app: no server-side secrets, no API routes. On
[Vercel](https://vercel.com), import the repo and deploy with the defaults. Security headers
(including a CSP that allows only this site and `api.anthropic.com`) are set in `next.config.js`.
Every visitor brings their own key, stored only in their own browser.

## The Chrome extension (not in the public build)

`extension/` is a separate Manifest V3 package that can fill application forms. It is turned off
in the app (`FEATURES.extension` in `lib/features.ts`) until its sync bridge only talks to a
verified extension, and it is not published.

## Project layout

Code lives in `app/` (routes), `components/` (UI) and `lib/` (logic, with co-located `*.test.ts`).
The resume tailoring engine is in `lib/resume/engine/`, scoring in `lib/scoring/` and
`lib/eligibility/`.
