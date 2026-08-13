/**
 * GET   /api/profile — the signed-in student's profile.
 * PATCH /api/profile — update it.
 *
 * The user id always comes from the session, never from the request body.
 */

import { profileSchema } from '../shared/schemas';
import { one } from './_lib/db';
import {
  fail,
  json,
  jsonCached,
  limitWrites,
  methodNotAllowed,
  readBody,
  requireSameOrigin,
  requireUser,
  track,
} from './_lib/http';

export const config = { runtime: 'edge' };

const SELECT = `SELECT user_id       AS "userId",
                       full_name     AS "fullName",
                       institution,
                       faculty,
                       department,
                       programme,
                       level,
                       expected_graduation_year AS "expectedGraduationYear",
                       grading_system_id        AS "gradingSystemId",
                       onboarding_completed_at  AS "onboardingCompletedAt"
                  FROM profiles WHERE user_id = $1`;

export default async function handler(request: Request): Promise<Response> {
  const crossSite = requireSameOrigin(request);
  if (crossSite) return crossSite;

  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

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
         expected_graduation_year = COALESCE($8, expected_graduation_year),
         grading_system_id = COALESCE($9, grading_system_id),
         onboarding_completed_at = COALESCE(onboarding_completed_at, now())
       WHERE user_id = $1
       RETURNING user_id AS "userId", full_name AS "fullName", institution, faculty,
                 department, programme, level,
                 expected_graduation_year AS "expectedGraduationYear",
                 grading_system_id AS "gradingSystemId",
                 onboarding_completed_at AS "onboardingCompletedAt"`,
      [
        auth.user.id,
        data.fullName ?? null,
        data.institution ?? null,
        data.faculty ?? null,
        data.department ?? null,
        data.programme ?? null,
        data.level ?? null,
        data.expectedGraduationYear ?? null,
        data.gradingSystemId ?? null,
      ],
    );

    await track('onboarding_completed', auth.user.id);
    return profile ? json({ profile }) : fail(404, 'Profile not found');
  }

  return methodNotAllowed(['GET', 'PATCH']);
}
