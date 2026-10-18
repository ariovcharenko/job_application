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

## The Chrome extension (optional, unpacked)

`extension/` is a separate Manifest V3 package that fills application forms from your Profile for
you to review. It never clicks Submit, never creates accounts or enters passwords, and never runs
on LinkedIn, Indeed or Jobright.

- **Install:** `cd extension && npm install && npm run build`, then in Chrome open
  `chrome://extensions`, turn on Developer mode, click Load unpacked and pick `extension/dist`.
- **Connect:** in the app open Settings > Chrome extension and click Connect. The extension opens
  its own small window with a code; check it matches the one in the app and click Allow. Only that
  click issues a pairing token. The extension's ID is fixed by the `key` in its manifest, so it is
  the same on every machine.
- **How it talks to the app:** Chrome's point-to-point messaging (`externally_connectable`, only
  from this site's origin and `localhost:3000`), never `window.postMessage`. No API key is ever
  sent: drafting an answer happens in the app, and the text goes back to the form only after you
  approve it there.
- **Where it runs:** Greenhouse, Lever, Ashby and Workday pages by default. Anywhere else only after
  you click "Use on this site" in its popup (Chrome asks for that one site).
- **Tests:** `cd extension && npm test && npx tsc --noEmit && npm run build`. The ATS form tests use
  fictional pages shaped like those sites (`extension/src/lib/__fixtures__`); they are not proof
  that a live form works.

## Project layout

Code lives in `app/` (routes), `components/` (UI) and `lib/` (logic, with co-located `*.test.ts`).
The resume tailoring engine is in `lib/resume/engine/`, scoring in `lib/scoring/` and
`lib/eligibility/`.
