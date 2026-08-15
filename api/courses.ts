/**
 * GET    /api/courses[?termId=…]
 * POST   /api/courses
 * PATCH  /api/courses?id=…
 * DELETE /api/courses?id=…
 *
 * Ownership is enforced in SQL (`WHERE user_id = $session`), so a forged id
 * simply affects zero rows rather than someone else's data.
 */

import { courseSchema, idSchema } from '../shared/schemas.js';
import { one, sql } from './_lib/db.js';
import {
  fail,
  idempotent,
  json,
  jsonCached,
  limitWrites,
  methodNotAllowed,
  readBody,
  requireSameOrigin,
  requireUser,
  track,
} from './_lib/http.js';
import { toVercelHandler } from './_lib/vercel.js';

const COLUMNS = `id, term_id AS "termId", name, code, units, priority,
                 exam_date AS "examDate", description, archived`;

export default toVercelHandler(handler);

async function handler(request: Request): Promise<Response> {
  const crossSite = requireSameOrigin(request);
  if (crossSite) return crossSite;

  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const userId = auth.user.id;

  if (request.method !== 'GET') {
    const limited = await limitWrites(request, userId, 'courses');
    if (limited) return limited;
  }

  if (request.method === 'GET') {
    const termId = url.searchParams.get('termId');
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 200), 200);
    const { rows } = termId
      ? await sql(
          `SELECT ${COLUMNS} FROM courses WHERE user_id = $1 AND term_id = $2
           ORDER BY created_at LIMIT $3`,
          [userId, termId, limit],
        )
      : await sql(`SELECT ${COLUMNS} FROM courses WHERE user_id = $1 ORDER BY created_at LIMIT $2`, [
          userId,
          limit,
        ]);
    return jsonCached(request, { courses: rows });
  }

  if (request.method === 'POST') {
    const body = await readBody(request, courseSchema);
    if (!body.ok) return body.response;

    // The term must belong to the caller.
    const term = await one<{ id: string }>('SELECT id FROM terms WHERE id = $1 AND user_id = $2', [
      body.data.termId,
      userId,
    ]);
    if (!term) return fail(404, 'Term not found');

    // Retries and double taps replay the first response instead of creating a
    // duplicate course.
    return idempotent(request, userId, 'courses', async () => {
      const course = await one(
        `INSERT INTO courses (user_id, term_id, name, code, units, priority, exam_date, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${COLUMNS}`,
        [
          userId,
          body.data.termId,
          body.data.name,
          body.data.code,
          body.data.units,
          body.data.priority,
          body.data.examDate,
          body.data.description,
        ],
      );
      await track('course_created', userId);
      return { status: 201, body: { course } };
    });
  }

  const id = idSchema.safeParse(url.searchParams.get('id') ?? '');
  if (!id.success) return fail(400, 'A course id is required');

  if (request.method === 'PATCH') {
    const body = await readBody(request, courseSchema.partial());
    if (!body.ok) return body.response;
    const data = body.data;

    const course = await one(
      `UPDATE courses SET
         name = COALESCE($3, name),
         code = COALESCE($4, code),
         units = COALESCE($5, units),
         priority = COALESCE($6, priority),
         exam_date = COALESCE($7, exam_date),
         description = COALESCE($8, description)
       WHERE id = $1 AND user_id = $2
       RETURNING ${COLUMNS}`,
      [
        id.data,
        userId,
        data.name ?? null,
        data.code ?? null,
        data.units ?? null,
        data.priority ?? null,
        data.examDate ?? null,
        data.description ?? null,
      ],
    );
    return course ? json({ course }) : fail(404, 'Course not found');
  }

  if (request.method === 'DELETE') {
    const result = await sql('DELETE FROM courses WHERE id = $1 AND user_id = $2', [
      id.data,
      userId,
    ]);
    return result.rowCount > 0 ? json({ ok: true }) : fail(404, 'Course not found');
  }

  return methodNotAllowed(['GET', 'POST', 'PATCH', 'DELETE']);
}
