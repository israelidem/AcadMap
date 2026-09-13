/**
 * GET   /api/profile — the signed-in student's profile.
 * PATCH /api/profile — update it.
 *
 * The user id always comes from the session, never from the request body.
 */

import { profileSchema } from '../shared/schemas.js';
import { one, sql } from './_lib/db.js';
import {
  fail,
  json,
  jsonCached,
  limitWrites,
  methodNotAllowed,
  readBody,
  requireSameOrigin,
  requireUser,
} from './_lib/http.js';
import { toVercelHandler } from './_lib/vercel.js';

const SELECT = `SELECT user_id       AS "id",
                        user_id       AS "userId",
                       full_name     AS "fullName",
                       institution,
                       faculty,
                       department,
                       programme,
                        level,
                        expected_graduation_year AS "expectedGraduationYear",
                        avatar_url                AS "avatarDataUrl",
                        grading_system_id        AS "gradingSystemId",
                        term_structure           AS "termStructure",
                        onboarding_completed_at  AS "onboardingCompletedAt"
                   FROM profiles WHERE user_id = $1`;

async function ensureProfile(userId: string): Promise<void> {
  await sql(`INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]);
  await sql(`INSERT INTO preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]);
}

export default toVercelHandler(handler);

async function handler(request: Request): Promise<Response> {
  const crossSite = requireSameOrigin(request);
  if (crossSite) return crossSite;

  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  await ensureProfile(auth.user.id);

  if (request.method === 'GET') {
    const profile = await one(SELECT, [auth.user.id]);
    return profile ? jsonCached(request, { profile }) : fail(404, 'Profile not found');
  }

  if (request.method === 'PATCH') {
    const limited = await limitWrites(request, auth.user.id, 'profile');
    if (limited) return limited;

    const body = await readBody(request, profileSchema.partial());
    if (!body.ok) return body.response;
    const data = body.data;

    const profile = await one(
      `UPDATE profiles SET
         full_name = COALESCE($2, full_name),
         institution = COALESCE($3, institution),
         faculty = COALESCE($4, faculty),
         department = COALESCE($5, department),
         programme = COALESCE($6, programme),
         level = COALESCE($7, level),
         expected_graduation_year = CASE WHEN $8::boolean THEN $9 ELSE expected_graduation_year END,
         avatar_url = CASE WHEN $10::boolean THEN $11 ELSE avatar_url END,
         grading_system_id = CASE WHEN $12::boolean THEN $13 ELSE grading_system_id END,
         term_structure = CASE WHEN $14::boolean THEN $15 ELSE term_structure END
        WHERE user_id = $1
        RETURNING user_id AS "id", user_id AS "userId", full_name AS "fullName", institution, faculty,
                  department, programme, level,
                  expected_graduation_year AS "expectedGraduationYear",
                  avatar_url AS "avatarDataUrl", grading_system_id AS "gradingSystemId",
                  term_structure AS "termStructure",
                  onboarding_completed_at AS "onboardingCompletedAt"`,
      [
        auth.user.id,
        data.fullName ?? null,
        data.institution ?? null,
        data.faculty ?? null,
        data.department ?? null,
        data.programme ?? null,
        data.level ?? null,
         data.expectedGraduationYear !== undefined,
         data.expectedGraduationYear ?? null,
         data.avatarDataUrl !== undefined,
         data.avatarDataUrl ?? null,
         data.gradingSystemId !== undefined,
         data.gradingSystemId ?? null,
         data.termStructure !== undefined,
         data.termStructure ?? null,
       ],
     );

    return profile ? json({ profile }) : fail(404, 'Profile not found');
  }

  return methodNotAllowed(['GET', 'PATCH']);
}
