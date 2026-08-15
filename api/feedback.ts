/**
 * POST  /api/feedback            — students submit bugs, ideas and feedback.
 * GET   /api/feedback            — owner only: list submissions.
 * PATCH /api/feedback?id=…       — owner only: change status (ADM-006).
 */

import { z } from 'zod';
import { feedbackSchema, feedbackStatusSchema, idSchema } from '../shared/schemas';
import { one, sql } from './_lib/db';
import {
  clientIp,
  fail,
  json,
  logAdminAction,
  methodNotAllowed,
  rateLimit,
  readBody,
  requireOwner,
  requireSameOrigin,
  requireUser,
} from './_lib/http';
import { toVercelHandler } from './_lib/vercel';

const COLUMNS = `id, user_email AS "userEmail", category, message, status,
                 created_at AS "createdAt"`;

export default toVercelHandler(handler);

async function handler(request: Request): Promise<Response> {
  const crossSite = requireSameOrigin(request);
  if (crossSite) return crossSite;

  const url = new URL(request.url);

  if (request.method === 'POST') {
    const auth = await requireUser(request);
    if (!auth.ok) return auth.response;

    if (!(await rateLimit(`feedback:${clientIp(request)}`, 5, 3600))) {
      return fail(429, 'You have submitted a lot of feedback. Please try again later.');
    }

    const body = await readBody(request, feedbackSchema);
    if (!body.ok) return body.response;

    const submission = await one(
      `INSERT INTO feedback (user_id, user_email, category, message)
       VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
      [auth.user.id, auth.user.email, body.data.category, body.data.message],
    );
    return json({ feedback: submission }, { status: 201 });
  }

  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;

  if (request.method === 'GET') {
    const status = url.searchParams.get('status');
    const parsedStatus = status ? feedbackStatusSchema.safeParse(status) : null;
    if (parsedStatus && !parsedStatus.success) return fail(400, 'Invalid status');

    const { rows } = parsedStatus
      ? await sql(
          `SELECT ${COLUMNS} FROM feedback WHERE status = $1 ORDER BY created_at DESC LIMIT 200`,
          [parsedStatus.data],
        )
      : await sql(`SELECT ${COLUMNS} FROM feedback ORDER BY created_at DESC LIMIT 200`);
    return json({ feedback: rows });
  }

  if (request.method === 'PATCH') {
    const id = idSchema.safeParse(url.searchParams.get('id') ?? '');
    if (!id.success) return fail(400, 'A feedback id is required');

    const body = await readBody(request, z.object({ status: feedbackStatusSchema }));
    if (!body.ok) return body.response;

    const updated = await one(
      `UPDATE feedback SET status = $2 WHERE id = $1 RETURNING ${COLUMNS}`,
      [id.data, body.data.status],
    );
    if (!updated) return fail(404, 'Submission not found');

    await logAdminAction(owner.user.email, `feedback:${body.data.status}`, `feedback/${id.data}`);
    return json({ feedback: updated });
  }

  return methodNotAllowed(['GET', 'POST', 'PATCH']);
}
