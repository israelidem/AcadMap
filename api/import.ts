/**
 * POST /api/import — adopt a guest's local data into their new account.
 *
 * A student can use AcadMap as a guest (everything lives in localStorage). When
 * they register, whatever they already built should follow them rather than being
 * thrown away, so the client posts its local rows here once, immediately after
 * registration.
 *
 * Rules that make this safe:
 *   * The user id comes from the session, never the payload.
 *   * Every row is validated by the same schemas the normal endpoints use, and
 *     the bundle is capped in size.
 *   * Grade points are resolved from a grading system owned by this user — an
 *     imported result cannot invent its own points.
 *   * The import only runs on an empty account, so a retried or replayed request
 *     cannot duplicate a student's academic record.
 *
 * Ids inside the bundle are the guest's local ids; they are rewritten to fresh
 * UUIDs here, which is why the ids are generated in this function rather than by
 * the database default.
 */

import { importBundleSchema } from '../shared/schemas';
import { one, sql } from './_lib/db';
import {
  fail,
  json,
  limitWrites,
  methodNotAllowed,
  readBody,
  requireSameOrigin,
  requireUser,
  track,
} from './_lib/http';

/** Rewrites a bundle-local id to the UUID we inserted for it. */
type IdMap = Map<string, string>;

function mapped(map: IdMap, localId: string | null): string | null {
  if (!localId) return null;
  return map.get(localId) ?? null;
}

export default async function handler(request: Request): Promise<Response> {
  const crossSite = requireSameOrigin(request);
  if (crossSite) return crossSite;

  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  if (request.method !== 'POST') return methodNotAllowed(['POST']);

  const limited = await limitWrites(request, userId, 'import');
  if (limited) return limited;

  const body = await readBody(request, importBundleSchema);
  if (!body.ok) return body.response;
  // readBody hands back the payload as sent; parsing again applies the schema
  // defaults so every collection below is a real array rather than optional.
  const bundle = importBundleSchema.parse(body.data);

  // Import is a one-time adoption of guest data, not a merge tool.
  const existing = await one<{ count: number }>(
    `SELECT (SELECT count(*) FROM academic_years WHERE user_id = $1)
          + (SELECT count(*) FROM courses WHERE user_id = $1)
          + (SELECT count(*) FROM results WHERE user_id = $1) AS count`,
    [userId],
  );
  if ((existing?.count ?? 0) > 0) {
    return fail(409, 'This account already has academic data, so nothing was imported.');
  }

  /* ------------------------------ grading ------------------------------- */

  // Points come from a grading system this user owns: either the one they built
  // as a guest, or the one their profile already points at.
  let gradingSystemId: string | null = null;
  const points = new Map<string, number>();

  if (bundle.gradingSystem) {
    gradingSystemId = crypto.randomUUID();
    await sql(
      `INSERT INTO grading_systems (id, user_id, name, scale, is_preset)
       VALUES ($1, $2, $3, $4, false)`,
      [gradingSystemId, userId, bundle.gradingSystem.name, bundle.gradingSystem.scale],
    );

    const rules = bundle.gradingSystem.rules;
    await sql(
      `INSERT INTO grade_rules (id, grading_system_id, label, point, min_score, position)
       SELECT unnest($1::uuid[]), $2, unnest($3::text[]), unnest($4::numeric[]),
              unnest($5::numeric[]), unnest($6::int[])
       ON CONFLICT (grading_system_id, label) DO NOTHING`,
      [
        rules.map(() => crypto.randomUUID()),
        gradingSystemId,
        rules.map((rule) => rule.name),
        rules.map((rule) => rule.point),
        rules.map((rule) => rule.minScore),
        rules.map((_, index) => index),
      ],
    );

    for (const rule of rules) points.set(rule.name.toLowerCase(), rule.point);
  } else {
    const { rows } = await sql<{ label: string; point: number }>(
      `SELECT r.label, r.point::float8 AS point
         FROM grade_rules r
         JOIN grading_systems g ON g.id = r.grading_system_id
         JOIN profiles p ON p.grading_system_id = g.id
        WHERE p.user_id = $1`,
      [userId],
    );
    for (const row of rows) points.set(row.label.toLowerCase(), row.point);
  }

  // Reject the whole bundle rather than importing results with invented points.
  const unknownGrades = [
    ...new Set(
      bundle.results
        .map((result) => result.gradeName)
        .filter((grade) => !points.has(grade.toLowerCase())),
    ),
  ];
  if (unknownGrades.length > 0) {
    return fail(422, `These grades are not in your grading system: ${unknownGrades.join(', ')}`);
  }

  /* --------------------------- academic structure ----------------------- */

  const yearIds: IdMap = new Map();
  for (const year of bundle.academicYears) yearIds.set(year.localId, crypto.randomUUID());

  if (bundle.academicYears.length > 0) {
    await sql(
      `INSERT INTO academic_years (id, user_id, label, start_year, is_current)
       SELECT unnest($1::uuid[]), $2, unnest($3::text[]), unnest($4::int[]), unnest($5::bool[])
       ON CONFLICT (user_id, label) DO NOTHING`,
      [
        bundle.academicYears.map((year) => yearIds.get(year.localId)),
        userId,
        bundle.academicYears.map((year) => year.label),
        bundle.academicYears.map((year) => year.startYear),
        bundle.academicYears.map((year) => year.isCurrent),
      ],
    );
  }

  // A term whose year did not come through would be an orphan, so it is dropped.
  const terms = bundle.terms.filter((term) => yearIds.has(term.academicYearId));
  const termIds: IdMap = new Map();
  for (const term of terms) termIds.set(term.localId, crypto.randomUUID());

  if (terms.length > 0) {
    await sql(
      `INSERT INTO terms (id, user_id, academic_year_id, label, position, start_date, end_date, is_current)
       SELECT unnest($1::uuid[]), $2, unnest($3::uuid[]), unnest($4::text[]),
              unnest($5::int[]), unnest($6::date[]), unnest($7::date[]), unnest($8::bool[])`,
      [
        terms.map((term) => termIds.get(term.localId)),
        userId,
        terms.map((term) => yearIds.get(term.academicYearId)),
        terms.map((term) => term.label),
        terms.map((term) => term.position),
        terms.map((term) => term.startDate),
        terms.map((term) => term.endDate),
        terms.map((term) => term.isCurrent),
      ],
    );
  }

  /* ------------------------------- courses ------------------------------ */

  const courses = bundle.courses.filter((course) => termIds.has(course.termId));
  const courseIds: IdMap = new Map();
  for (const course of courses) courseIds.set(course.localId, crypto.randomUUID());

  if (courses.length > 0) {
    await sql(
      `INSERT INTO courses (id, user_id, term_id, name, code, units, priority, exam_date, description)
       SELECT unnest($1::uuid[]), $2, unnest($3::uuid[]), unnest($4::text[]), unnest($5::text[]),
              unnest($6::numeric[]), unnest($7::text[]), unnest($8::date[]), unnest($9::text[])`,
      [
        courses.map((course) => courseIds.get(course.localId)),
        userId,
        courses.map((course) => termIds.get(course.termId)),
        courses.map((course) => course.name),
        courses.map((course) => course.code),
        courses.map((course) => course.units),
        courses.map((course) => course.priority),
        courses.map((course) => course.examDate),
        courses.map((course) => course.description),
      ],
    );
  }

  const topics = bundle.topics.filter((topic) => courseIds.has(topic.courseId));
  const topicIds: IdMap = new Map();
  for (const topic of topics) topicIds.set(topic.localId, crypto.randomUUID());

  if (topics.length > 0) {
    await sql(
      // The client thinks in minutes per topic; the table stores hours.
      `INSERT INTO course_topics (id, user_id, course_id, title, position, difficulty, workload_hours)
       SELECT unnest($1::uuid[]), $2, unnest($3::uuid[]), unnest($4::text[]),
              unnest($5::int[]), unnest($6::text[]), unnest($7::numeric[])`,
      [
        topics.map((topic) => topicIds.get(topic.localId)),
        userId,
        topics.map((topic) => courseIds.get(topic.courseId)),
        topics.map((topic) => topic.title),
        topics.map((_, index) => index),
        topics.map((topic) => topic.difficulty),
        topics.map((topic) => Math.max(0.5, topic.estimatedMinutes / 60)),
      ],
    );
  }

  /* ------------------------------- results ------------------------------ */

  const results = bundle.results.filter((result) => termIds.has(result.termId));
  if (results.length > 0) {
    await sql(
      `INSERT INTO results (user_id, term_id, course_id, course_name, course_code, units,
                            grade_label, grade_point, is_repeat, counts_in_gpa)
       SELECT $1, unnest($2::uuid[]), unnest($3::uuid[]), unnest($4::text[]), unnest($5::text[]),
              unnest($6::numeric[]), unnest($7::text[]), unnest($8::numeric[]), unnest($9::bool[]),
              unnest($10::bool[])`,
      [
        userId,
        results.map((result) => termIds.get(result.termId)),
        results.map((result) => mapped(courseIds, result.courseId)),
        results.map((result) => result.courseName),
        results.map((result) => result.courseCode),
        results.map((result) => result.units),
        results.map((result) => result.gradeName),
        results.map((result) => points.get(result.gradeName.toLowerCase())),
        results.map((result) => result.isRepeat),
        results.map((result) => result.countsInGpa),
      ],
    );
  }

  /* ------------------------------- planner ------------------------------ */

  if (bundle.events.length > 0) {
    await sql(
      `INSERT INTO events (user_id, course_id, type, title, date, time, end_time, notes)
       SELECT $1, unnest($2::uuid[]), unnest($3::text[]), unnest($4::text[]),
              unnest($5::date[]), unnest($6::text[]), unnest($7::text[]), unnest($8::text[])`,
      [
        userId,
        bundle.events.map((event) => mapped(courseIds, event.courseId)),
        bundle.events.map((event) => event.type),
        bundle.events.map((event) => event.title),
        bundle.events.map((event) => event.date),
        bundle.events.map((event) => event.startTime),
        bundle.events.map((event) => event.endTime),
        bundle.events.map((event) => event.notes),
      ],
    );
  }

  if (bundle.tasks.length > 0) {
    await sql(
      `INSERT INTO tasks (user_id, course_id, title, due_date, priority)
       SELECT $1, unnest($2::uuid[]), unnest($3::text[]), unnest($4::date[]), unnest($5::text[])`,
      [
        userId,
        bundle.tasks.map((task) => mapped(courseIds, task.courseId)),
        bundle.tasks.map((task) => task.title),
        bundle.tasks.map((task) => task.dueDate),
        bundle.tasks.map((task) => task.priority),
      ],
    );
  }

  if (bundle.availability.length > 0) {
    await sql(
      `INSERT INTO availability (user_id, weekday, start_time, end_time)
       SELECT $1, unnest($2::int[]), unnest($3::text[]), unnest($4::text[])`,
      [
        userId,
        bundle.availability.map((slot) => slot.weekday),
        bundle.availability.map((slot) => slot.startTime),
        bundle.availability.map((slot) => slot.endTime),
      ],
    );
  }

  if (bundle.goals.length > 0) {
    await sql(
      `INSERT INTO goals (user_id, term_id, type, title, target_value, due_date)
       SELECT $1, unnest($2::uuid[]), unnest($3::text[]), unnest($4::text[]),
              unnest($5::numeric[]), unnest($6::date[])`,
      [
        userId,
        bundle.goals.map((goal) => mapped(termIds, goal.termId)),
        bundle.goals.map((goal) => goal.type),
        bundle.goals.map((goal) => goal.title),
        bundle.goals.map((goal) => goal.targetValue),
        bundle.goals.map((goal) => goal.dueDate),
      ],
    );
  }

  /* ------------------------------- profile ------------------------------ */

  // Registration already created the profile row, so this fills in what the
  // student told us as a guest.
  const profile = bundle.profile ?? {};
  await sql(
    `UPDATE profiles SET
       full_name   = COALESCE(NULLIF($2, ''), full_name),
       institution = COALESCE(NULLIF($3, ''), institution),
       faculty     = COALESCE(NULLIF($4, ''), faculty),
       department  = COALESCE(NULLIF($5, ''), department),
       programme   = COALESCE(NULLIF($6, ''), programme),
       level       = COALESCE(NULLIF($7, ''), level),
       expected_graduation_year = COALESCE($8, expected_graduation_year),
       avatar_url  = COALESCE($9, avatar_url),
       grading_system_id = COALESCE($10, grading_system_id),
       term_structure = COALESCE($11, term_structure)
     WHERE user_id = $1`,
    [
      userId,
      profile.fullName ?? '',
      profile.institution ?? '',
      profile.faculty ?? '',
      profile.department ?? '',
      profile.programme ?? '',
      profile.level ?? '',
      profile.expectedGraduationYear ?? null,
      profile.avatarDataUrl ?? null,
      gradingSystemId,
      profile.termStructure ?? null,
    ],
  );

  await track('guest_data_imported', userId);

  return json({
    imported: {
      academicYears: yearIds.size,
      terms: terms.length,
      courses: courses.length,
      topics: topics.length,
      results: results.length,
      events: bundle.events.length,
      tasks: bundle.tasks.length,
      availability: bundle.availability.length,
      goals: bundle.goals.length,
      gradingSystem: gradingSystemId !== null,
    },
  });
}
