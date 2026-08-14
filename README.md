# AcadMap

An academic planning and performance platform for university and law students:
GPA/CGPA tracking, an automatic study planner, goals, projections and temporary
academic snapshots — in one place.

> "How am I doing?" and "What should I do next?"

Built to run entirely on free tiers: Vite + React on Vercel, Vercel Functions for
the API, Neon PostgreSQL for storage. No paid dependency is required for the MVP.

## Quick start

```bash
npm install
cp .env.example .env  # then fill in DATABASE_URL and OWNER_EMAIL
npm run db:push       # creates the schema in your Neon database
npm run dev           # http://localhost:5173
```

`npm run dev` serves both the client and the `api/` functions: a small Vite plugin
(`scripts/api-dev-plugin.ts`) mounts them on `/api/*` using the same file-based
routing Vercel uses, so no CLI or account linking is needed locally.

The app also runs fully offline against a local-storage store (`src/lib/store.ts`),
so you can explore every feature before any database exists. The first account you
register with the email in `OWNER_EMAIL` becomes the owner and can reach `/admin`.

```bash
npm test             # unit tests for the GPA engine, scheduler and streaks
npm run build        # typecheck + production build
```

## Project layout

```text
shared/     Framework-free domain logic shared by the UI and the API
              gpa.ts        quality points, GPA, CGPA, required GPA, projections
              scheduler.ts  study-plan generation (deadlines, priority, workload)
              streak.ts     streaks from completed sessions only
              grading.ts    4.0 / 5.0 presets + custom scales
              schemas.ts    Zod schemas used on both client and server
src/        React application
              pages/        landing, calculator, auth, onboarding, dashboard,
                            planner, courses, record, performance, goals,
                            profile, share, admin
              components/   design system, layout, charts, notifications
              lib/          store, auth, actions, hooks, theme, analytics
api/        Vercel Functions (Web Request/Response, no framework)
              _lib/         Neon HTTP client, sessions, rate limiting, hashing
db/         schema.sql — Neon PostgreSQL schema
```

## Features

**Guest** — GPA calculator with 4.0, 5.0 and custom scales; add, edit, remove and
reset courses; no account and no API request required.

**Student** — registration, login, recovery and persistent sessions; onboarding
(institution, programme, level, grading system, academic structure); academic
years and any number of terms (semester, trimester, quarter, custom); courses with
units, priority, topics and exam dates; results with term GPA and CGPA; dashboard;
availability windows; events and tasks; automatic study-session generation with
complete/skip/reschedule; streaks; goals; GPA projection and target calculator;
revocable, expiring share snapshots at `/share/{token}`; browser and in-app
notifications; feedback submission.

**Owner (`/admin`)** — overview metrics, user management (suspend, restore,
soft-delete), usage analytics with 1/7/30/90-day ranges, aggregated institution
insights, feedback triage, announcements, feature flags and an admin activity log.

## Deployment

1. Create a Neon project and apply the schema — either `npm run db:push` (uses
   Neon's HTTP endpoint, no psql required) or:
   ```bash
   psql "$DATABASE_URL" -f db/schema.sql
   ```
2. Import the repository into Vercel (framework preset: Vite).
3. Set the environment variables from `.env.example`:
   `DATABASE_URL`, `OWNER_EMAIL`, and `APP_ORIGIN` only for cross-origin setups.
4. Deploy. `vercel.json` handles SPA rewrites, asset caching and security headers.

## API

```text
POST   /api/auth/register        GET    /api/auth/session
POST   /api/auth/login           DELETE /api/auth/session
GET    /api/profile              PATCH  /api/profile
GET    /api/courses              POST   /api/courses
PATCH  /api/courses?id=…         DELETE /api/courses?id=…
GET    /api/results              POST   /api/results
GET    /api/share-snapshots      POST /api/share-snapshots   DELETE ?id=  (revoke)
GET    /api/share/:token         (public; token is stored only as a SHA-256 hash)
POST   /api/feedback             GET/PATCH /api/feedback   (owner)
GET    /api/admin/overview                                 (owner)
```

## Security notes

- Session cookies are HttpOnly, Secure and SameSite=Lax; the session is re-read
  from the database on every request, so suspension takes effect immediately.
- The user id always comes from the session. Ownership is enforced in SQL
  (`WHERE user_id = …`), so forged ids affect zero rows.
- Grade points are resolved from the student's own grading system server-side
  rather than trusted from the request body.
- Every query is parameterised; database errors are logged, never returned.
- Admin authorisation is checked on the server for each admin request — hiding the
  UI is not treated as access control.
- Snapshots store only the fields the student selected, and support revocation and
  expiry.
- Auth, feedback and public snapshot routes are rate-limited using a Postgres
  counter (no paid Redis).

## Known gaps

The React app reads and writes through the local-storage store and syncs it to
Postgres in the background (`src/lib/sync.ts` ↔ `POST /api/sync`), which is what
makes the same account work on a phone and a laptop and keeps the app usable
offline. That means the store is the source of truth for the UI and the database is
the durable copy, per row, last-write-wins with conflicts reported. Repeated-course
rules are modelled (`replaces_id`) but the configurable academic-rules module is
deliberately deferred.


Password recovery sends a real email, over Brevo's or Resend's HTTP API depending
on which key is set (`BREVO_API_KEY` or `RESEND_API_KEY`, plus `MAIL_FROM`). With
neither, the endpoint answers 503 and the app says email is not configured rather
than claiming a message is on its way. Neon Auth is not used: it replaces the
whole identity layer — its own user store, sessions and email flows — and this app
already owns `users`, `sessions` and `password_resets`, so adopting it would be a
rewrite of authentication rather than a way to send one email.


