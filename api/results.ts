/**
 * GET  /api/results[?termId=…] — results plus server-computed GPA/CGPA.
 * POST /api/results             — record a grade.
 *
 * The client computes GPA instantly for UX, but these numbers are the source of
 * truth: grade points are resolved from the student's own grading system rather
 * than accepted from the request.
 */

import { idSchema, resultSchema } from '../shared/schemas.js';
import { computeGpa } from '../shared/gpa.js';
import { one, sql } from './_lib/db.js';
import {
  fail,
  idempotent,
  jsonCached,
  limitWrites,
  methodNotAllowed,
  purgeExpiredSometimes,
  readBody,
  requireSameOrigin,
  requireUser,
  track,
} from './_lib/http.js';
import { toVercelHandler } from './_lib/vercel.js';

interface ResultRow {
  id: string;
  termId: string;
  courseName: string;
  courseCode: string;
  units: number;
  gradeName: string;
  gradePoint: number;
  countsInGpa: boolean;
}

const COLUMNS = `id, term_id AS "termId", course_name AS "courseName", course_code AS "courseCode",
                 units::float8 AS units, grade_label AS "gradeName",
                 grade_point::float8 AS "gradePoint", counts_in_gpa AS "countsInGpa"`;

export default toVercelHandler(handler);

async function handler(request: Request): Promise<Response> {
  const crossSite = requireSameOrigin(request);
  if (crossSite) return crossSite;

  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const termId = url.searchParams.get('termId');
    const parsedTerm = termId ? idSchema.safeParse(termId) : null;
    if (parsedTerm && !parsedTerm.success) return fail(400, 'Invalid term id');

    const { rows } = parsedTerm
      ? await sql<ResultRow>(
          `SELECT ${COLUMNS} FROM results WHERE user_id = $1 AND term_id = $2 ORDER BY created_at`,
          [userId, parsedTerm.data],
        )
      : await sql<ResultRow>(
          `SELECT ${COLUMNS} FROM results WHERE user_id = $1 ORDER BY created_at LIMIT 500`,
          [userId],
        );

    // Pass/fail and audited courses are excluded from the GPA but still listed.
    const breakdown = computeGpa(
      rows.map((row) => ({
        units: row.units,
        gradePoint: row.gradePoint,
        countsInGpa: row.countsInGpa,
      })),
    );
    // Results change rarely, so an unchanged record answers 304 on revisit.
    return jsonCached(request, { results: rows, ...breakdown });
  }

  if (request.method === 'POST') {
    const limited = await limitWrites(request, userId, 'results');
    if (limited) return limited;
    await purgeExpiredSometimes();

    const body = await readBody(request, resultSchema);
    if (!body.ok) return body.response;
    const data = body.data;

    const term = await one<{ id: string }>('SELECT id FROM terms WHERE id = $1 AND user_id = $2', [
      data.termId,
      userId,
    ]);
    if (!term) return fail(404, 'Term not found');

    // Resolve the grade point from the student's grading system — never trust a
    // client-supplied point value.
    const rule = await one<{ point: number }>(
      `SELECT r.point::float8 AS point
         FROM grade_rules r
         JOIN grading_systems g ON g.id = r.grading_system_id
         JOIN profiles p ON p.grading_system_id = g.id
        WHERE p.user_id = $1 AND lower(r.label) = lower($2)`,
      [userId, data.gradeName],
    );
    if (!rule) return fail(422, 'That grade is not defined in your grading system.');

    // A double-tapped "Save grade" must not record the course twice.
    return idempotent(request, userId, 'results', async () => {
      const result = await one(
        `INSERT INTO results (user_id, term_id, course_id, course_name, course_code, units,
                              grade_label, grade_point, is_repeat, replaces_id, counts_in_gpa)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING ${COLUMNS}`,
        [
          userId,
          data.termId,
          data.courseId,
          data.courseName,
          data.courseCode,
          data.units,
          data.gradeName,
          rule.point,
          data.isRepeat,
          data.replacesResultId,
          data.countsInGpa,
        ],
      );
      await track('result_recorded', userId);
      return { status: 201, body: { result } };
    });
  }

  return methodNotAllowed(['GET', 'POST']);
}
