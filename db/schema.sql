-- AcadMap — Neon PostgreSQL schema (MVP)
--
-- Principles:
--   * Every student-owned row carries user_id and cascades on delete.
--   * Nothing about semesters, levels or grading scales is hard-coded: terms and
--     grade rules are data, not enums.
--   * Indexes cover the read paths the app actually uses (per-user, per-term).
--
-- Apply with:  psql "$DATABASE_URL" -f db/schema.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

/* -------------------------------------------------------------------------- */
/* Accounts — owned by Better Auth                                            */
/* -------------------------------------------------------------------------- */

/*
 * These four tables are Better Auth's, not ours.
 *
 * Their names and columns are dictated by the library (quoted camelCase, `user`
 * singular and reserved, so it must stay quoted everywhere). They are written out
 * here rather than left to `better-auth migrate` so that one file still describes
 * the whole database and `npm run db:push` remains the only step needed to stand
 * one up. The definitions match `getAuthTables()` for better-auth 1.6; if that
 * version is raised, re-check them.
 *
 * Do not add application columns here beyond the three declared as
 * `additionalFields` in api/_lib/auth.ts — Better Auth writes this row itself and
 * a column it does not know about must be nullable or defaulted, or sign-up fails.
 *
 * The old hand-rolled `users`, `sessions` and `password_resets` tables are gone.
 * Sessions and reset tokens now live in `session` and `verification`, managed by
 * the library, which is the point of the change: no application code decides when
 * a session is valid.
 */

CREATE TABLE IF NOT EXISTS "user" (
  "id"            TEXT PRIMARY KEY,
  "name"          TEXT NOT NULL,
  "email"         TEXT NOT NULL UNIQUE,
  "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  "image"         TEXT,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  /* Application fields, declared as additionalFields in api/_lib/auth.ts. */
  "role"          TEXT NOT NULL DEFAULT 'STUDENT' CHECK ("role" IN ('STUDENT', 'OWNER')),
  "status"        TEXT NOT NULL DEFAULT 'ACTIVE'  CHECK ("status" IN ('ACTIVE', 'SUSPENDED', 'DELETED')),
  "lastSeenAt"    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS "session" (
  "id"        TEXT PRIMARY KEY,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "token"     TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId"    TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_user_idx ON "session"("userId");
CREATE INDEX IF NOT EXISTS session_expires_idx ON "session"("expiresAt");

/*
 * One row per way of signing in. Email/password accounts keep the hash in
 * `password`; a social provider added later stores its tokens in the same row
 * shape, which is why the column list looks larger than email/password needs.
 */
CREATE TABLE IF NOT EXISTS "account" (
  "id"                    TEXT PRIMARY KEY,
  "accountId"             TEXT NOT NULL,
  "providerId"            TEXT NOT NULL,
  "userId"                TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "accessToken"           TEXT,
  "refreshToken"          TEXT,
  "idToken"               TEXT,
  "accessTokenExpiresAt"  TIMESTAMPTZ,
  "refreshTokenExpiresAt" TIMESTAMPTZ,
  "scope"                 TEXT,
  "password"              TEXT,
  "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_user_idx ON "account"("userId");

/* Short-lived tokens: password reset today, email verification when enabled. */
CREATE TABLE IF NOT EXISTS "verification" (
  "id"         TEXT PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value"      TEXT NOT NULL,
  "expiresAt"  TIMESTAMPTZ NOT NULL,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON "verification"("identifier");

/* -------------------------------------------------------------------------- */
/* Student data                                                               */
/* -------------------------------------------------------------------------- */

/*
 * Every table below keys on `"user"."id"`, which is TEXT: Better Auth generates
 * its own ids, so nothing here is a UUID any more. All of them cascade, so
 * deleting the account really does delete the account.
 */

CREATE TABLE IF NOT EXISTS profiles (
  user_id                  TEXT PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,

  full_name                TEXT NOT NULL DEFAULT '',
  institution              TEXT NOT NULL DEFAULT '',
  faculty                  TEXT NOT NULL DEFAULT '',
  department               TEXT NOT NULL DEFAULT '',
  programme                TEXT NOT NULL DEFAULT '',
  level                    TEXT NOT NULL DEFAULT '',
  expected_graduation_year INTEGER,
  avatar_url               TEXT,
  grading_system_id        UUID,
  onboarding_completed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS profiles_institution_idx ON profiles(institution);

CREATE TABLE IF NOT EXISTS preferences (
  user_id                 TEXT PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  theme                   TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  notifications_enabled   BOOLEAN NOT NULL DEFAULT true,
  reminder_lead_minutes   INTEGER NOT NULL DEFAULT 30 CHECK (reminder_lead_minutes BETWEEN 0 AND 240),
  default_session_minutes INTEGER NOT NULL DEFAULT 60 CHECK (default_session_minutes BETWEEN 15 AND 300)
);

/* -------------------------------------------------------------------------- */
/* Grading                                                                    */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS grading_systems (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  name      TEXT NOT NULL,
  scale     NUMERIC(4, 2) NOT NULL CHECK (scale > 0),
  is_preset BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS grading_systems_user_idx ON grading_systems(user_id);

CREATE TABLE IF NOT EXISTS grade_rules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grading_system_id UUID NOT NULL REFERENCES grading_systems(id) ON DELETE CASCADE,
  label             TEXT NOT NULL,
  point             NUMERIC(4, 2) NOT NULL CHECK (point >= 0),
  min_score         NUMERIC(5, 2),
  position          INTEGER NOT NULL DEFAULT 0,
  UNIQUE (grading_system_id, label)
);

/* -------------------------------------------------------------------------- */
/* Academic structure                                                         */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS academic_years (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  label      TEXT NOT NULL,
  start_year INTEGER NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (user_id, label)
);
CREATE INDEX IF NOT EXISTS academic_years_user_idx ON academic_years(user_id);

CREATE TABLE IF NOT EXISTS terms (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  label            TEXT NOT NULL,
  position         INTEGER NOT NULL DEFAULT 0,
  start_date       DATE,
  end_date         DATE,
  is_current       BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS terms_user_idx ON terms(user_id);
CREATE INDEX IF NOT EXISTS terms_year_idx ON terms(academic_year_id, position);

/* -------------------------------------------------------------------------- */
/* Courses, topics, results                                                   */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS courses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  term_id     UUID NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL DEFAULT '',
  units       NUMERIC(4, 1) NOT NULL CHECK (units > 0 AND units <= 30),
  priority    TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('HIGH', 'MEDIUM', 'LOW')),
  exam_date   DATE,
  description TEXT,
  archived    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS courses_user_term_idx ON courses(user_id, term_id);

CREATE TABLE IF NOT EXISTS course_topics (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  course_id      UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  position       INTEGER NOT NULL DEFAULT 0,
  difficulty     TEXT NOT NULL DEFAULT 'NORMAL' CHECK (difficulty IN ('EASY', 'NORMAL', 'HARD')),
  workload_hours NUMERIC(4, 1) NOT NULL DEFAULT 2 CHECK (workload_hours > 0),
  completed      BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS course_topics_course_idx ON course_topics(course_id, position);

CREATE TABLE IF NOT EXISTS results (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  term_id      UUID NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  course_id    UUID REFERENCES courses(id) ON DELETE SET NULL,
  course_name  TEXT NOT NULL,
  course_code  TEXT NOT NULL DEFAULT '',
  units        NUMERIC(4, 1) NOT NULL CHECK (units > 0),
  grade_label  TEXT NOT NULL,
  grade_point  NUMERIC(4, 2) NOT NULL CHECK (grade_point >= 0),
  is_repeat    BOOLEAN NOT NULL DEFAULT false,
  replaces_id  UUID REFERENCES results(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS results_user_term_idx ON results(user_id, term_id);

/* -------------------------------------------------------------------------- */
/* Planner                                                                    */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS events (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
  type      TEXT NOT NULL CHECK (type IN ('EXAM', 'TEST', 'ASSIGNMENT', 'OTHER')),
  title     TEXT NOT NULL,
  date      DATE NOT NULL,
  time      TEXT,
  notes     TEXT
);
CREATE INDEX IF NOT EXISTS events_user_date_idx ON events(user_id, date);

CREATE TABLE IF NOT EXISTS tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  course_id    UUID REFERENCES courses(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  due_date     DATE,
  priority     TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('HIGH', 'MEDIUM', 'LOW')),
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_user_due_idx ON tasks(user_id, due_date);

CREATE TABLE IF NOT EXISTS availability (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  weekday    SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS availability_user_idx ON availability(user_id, weekday);

CREATE TABLE IF NOT EXISTS study_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  course_id      UUID REFERENCES courses(id) ON DELETE CASCADE,
  topic_id       UUID REFERENCES course_topics(id) ON DELETE SET NULL,
  date           DATE NOT NULL,
  start_time     TEXT NOT NULL,
  end_time       TEXT NOT NULL,
  minutes        INTEGER NOT NULL CHECK (minutes > 0),
  status         TEXT NOT NULL DEFAULT 'SCHEDULED'
                 CHECK (status IN ('SCHEDULED', 'COMPLETED', 'SKIPPED', 'RESCHEDULED')),
  generated      BOOLEAN NOT NULL DEFAULT false,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS study_sessions_user_date_idx ON study_sessions(user_id, date);
CREATE INDEX IF NOT EXISTS study_sessions_status_idx ON study_sessions(user_id, status);

/* -------------------------------------------------------------------------- */
/* Goals, sharing, notifications                                              */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS goals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  term_id      UUID REFERENCES terms(id) ON DELETE SET NULL,
  type         TEXT NOT NULL CHECK (type IN ('TARGET_CGPA', 'TARGET_GPA', 'SESSIONS', 'STREAK')),
  title        TEXT NOT NULL,
  target_value NUMERIC(6, 2) NOT NULL CHECK (target_value > 0),
  due_date     DATE,
  achieved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS goals_user_idx ON goals(user_id);

CREATE TABLE IF NOT EXISTS share_snapshots (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  fields     TEXT[] NOT NULL,
  payload    JSONB NOT NULL,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  views      INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS share_snapshots_user_idx ON share_snapshots(user_id);

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, created_at DESC);

/* -------------------------------------------------------------------------- */
/* Product management (owner-only)                                            */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS feedback (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  user_email TEXT,
  category   TEXT NOT NULL CHECK (category IN ('BUG', 'FEATURE_REQUEST', 'GENERAL_FEEDBACK')),
  message    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feedback_status_idx ON feedback(status, created_at DESC);

CREATE TABLE IF NOT EXISTS announcements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS feature_flags (
  key     TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO feature_flags (key, enabled) VALUES
  ('gpaCalculatorEnabled', true),
  ('gpaProjectionEnabled', true),
  ('plannerEnabled', true),
  ('goalsEnabled', true),
  ('streaksEnabled', true),
  ('sharingEnabled', true),
  ('notificationsEnabled', true)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS admin_activity_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email TEXT NOT NULL,
  action      TEXT NOT NULL,
  resource    TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_activity_logs_idx ON admin_activity_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS usage_events (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_events_name_idx ON usage_events(name, created_at DESC);

/* Rate limiting without extra infrastructure: one counter row per key/window. */
CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  hits         INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_start)
);
/* Lets the opportunistic purge delete old windows without a full scan. */
CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON rate_limits(window_start);

/* -------------------------------------------------------------------------- */
/* Idempotency                                                                */
/* -------------------------------------------------------------------------- */

/*
 * A retried POST (flaky connection, impatient double-tap) must not create a
 * second course, result or snapshot. The client sends an Idempotency-Key and we
 * replay the first response for that key instead of re-running the write.
 */
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key         TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  endpoint    TEXT NOT NULL,
  status      INTEGER NOT NULL,
  response    JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, endpoint, key)
);
CREATE INDEX IF NOT EXISTS idempotency_keys_created_idx ON idempotency_keys(created_at);

/* -------------------------------------------------------------------------- */
/* Supporting indexes for the admin and planner read paths                    */
/* -------------------------------------------------------------------------- */

/*
 * Email is already UNIQUE, but sign-in is case-insensitive: this makes
 * lower(email) lookups an index scan and makes "Ada@x.com" vs "ada@x.com"
 * impossible to register twice.
 */
CREATE UNIQUE INDEX IF NOT EXISTS user_email_lower_idx ON "user"(lower("email"));

/* Active-user counts filter on lastSeenAt over a rolling window. */
CREATE INDEX IF NOT EXISTS user_last_seen_idx ON "user"("lastSeenAt" DESC);


/* Per-user analytics (DAU/WAU/MAU) rather than per-event-name totals. */
CREATE INDEX IF NOT EXISTS usage_events_user_idx ON usage_events(user_id, created_at DESC);

/* Session and token expiry sweeps live with the Better Auth tables above. */
CREATE INDEX IF NOT EXISTS verification_expires_idx ON "verification"("expiresAt");


/*
 * The planner asks "what is already booked from today onwards?" on every
 * generation. A partial index keeps that lookup proportional to the sessions
 * that are still pending rather than the student's whole history.
 */
CREATE INDEX IF NOT EXISTS study_sessions_scheduled_idx
  ON study_sessions(user_id, date)
  WHERE status = 'SCHEDULED';

/* Only live snapshots are ever resolved by token. */
CREATE INDEX IF NOT EXISTS share_snapshots_live_idx
  ON share_snapshots(token)
  WHERE revoked_at IS NULL;

/* Feedback is listed per student in the app and by status in the admin UI. */
CREATE INDEX IF NOT EXISTS feedback_user_idx ON feedback(user_id, created_at DESC);

/* ---------------------------------------------------------------------------
 * Cross-device sync
 *
 * A student's academic data is created on their device — offline included — and
 * replicated here so a phone and a laptop show the same account. Each row is
 * stored as it exists on the client, keyed by the client-generated UUID, with
 * the two timestamps the merge engine needs.
 *
 * Why a row store rather than writing straight into the normalised tables
 * above: sync needs per-row `updated_at` and replicable deletes for fourteen
 * collections, and the reconciliation logic must be identical on both sides
 * (see shared/sync.ts). One table keeps the server side small enough to reason
 * about and means a new synced collection needs no migration. The normalised
 * tables continue to serve the features that query by column — the admin
 * overview, shared snapshots, profiles.
 *
 * `data` holds the row exactly as the client stores it. It is never trusted for
 * ownership: `user_id` comes from the session, never from the payload.
 * ------------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS sync_rows (
  user_id     TEXT        NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  collection  TEXT        NOT NULL,
  row_id      UUID        NOT NULL,
  data        JSONB       NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL,
  /* Non-null marks a delete. Kept as a tombstone so a device that has been
   * offline learns about it instead of pushing the row back. */
  deleted_at  TIMESTAMPTZ,
  PRIMARY KEY (user_id, collection, row_id)
);

/* Every pull is "everything of mine that changed since X". */
CREATE INDEX IF NOT EXISTS sync_rows_pull_idx ON sync_rows(user_id, updated_at);

/* Lets tombstone pruning find expired markers without scanning live rows. */
CREATE INDEX IF NOT EXISTS sync_rows_tombstone_idx
  ON sync_rows(deleted_at)
  WHERE deleted_at IS NOT NULL;


COMMIT;

/* -------------------------------------------------------------------------- */
/* Maintenance                                                                */
/* -------------------------------------------------------------------------- */

/*
 * Housekeeping for the rows that are pure churn. Safe to run any time; the API
 * also purges opportunistically so a cron job is optional on the free tier.
 *
 *   SELECT acadmap_purge_expired();
 */
CREATE OR REPLACE FUNCTION acadmap_purge_expired() RETURNS void AS $$
BEGIN
  /* Better Auth ignores rows past their expiry; deleting them is just tidiness. */
  DELETE FROM "session"      WHERE "expiresAt" < now();
  DELETE FROM "verification" WHERE "expiresAt" < now();
  DELETE FROM rate_limits     WHERE window_start < now() - INTERVAL '1 day';

  DELETE FROM idempotency_keys WHERE created_at < now() - INTERVAL '1 day';
  DELETE FROM usage_events    WHERE created_at < now() - INTERVAL '180 days';
END;
$$ LANGUAGE plpgsql;

/* -------------------------------------------------------------------------- */
/* Additive changes                                                           */
/* -------------------------------------------------------------------------- */

/*
 * Columns added after the first draft. Written as idempotent ALTERs rather than
 * edits to the definitions above so that `npm run db:push` can be re-run against
 * a database that already holds student data.
 *
 * Each one closes a gap where the client models something the server could not
 * store, which would have quietly lost data on save:
 */

/* Pass/fail and audited courses must be excludable from GPA. */
ALTER TABLE results
  ADD COLUMN IF NOT EXISTS counts_in_gpa BOOLEAN NOT NULL DEFAULT true;

/* Study progress per topic drives the planner's remaining workload. */
ALTER TABLE course_topics
  ADD COLUMN IF NOT EXISTS completed_minutes INTEGER NOT NULL DEFAULT 0
  CHECK (completed_minutes >= 0);

/* An exam from 09:00 to 12:00 is a range, not an instant. */
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS end_time TEXT;

/* Semester, trimester, quarter or custom — never assumed. */
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS term_structure TEXT NOT NULL DEFAULT 'SEMESTER'
  CHECK (term_structure IN ('SEMESTER', 'TRIMESTER', 'QUARTER', 'CUSTOM'));
