/**
 * Domain mutations.
 *
 * Every action takes the acting `userId` and only ever touches rows owned by
 * that user — the same ownership rule the API enforces server-side.
 */

import type {
  AcademicEvent,
  AcademicYear,
  Announcement,
  AppNotification,
  AvailabilitySlot,
  Course,
  CourseTopic,
  DateStr,
  Difficulty,
  FeatureFlags,
  Feedback,
  FeedbackStatus,
  Goal,
  GradeRule,
  GradingSystem,
  ID,
  Preferences,
  Priority,
  Result,
  ShareField,
  ShareSnapshot,
  StudySession,
  Task,
  Term,
  TermStructure,
  Weekday,
} from '@shared/types';
import { generateStudyPlan, type PlannerConfig } from '@shared/scheduler';
import { toMinutes, todayStr } from '@shared/time';
import { getDatabase, update } from './store';
import { nowIso, uid } from './utils';
import { trackEvent } from './analytics';

/* -------------------------------------------------------------------------- */
/* Profile & preferences                                                      */
/* -------------------------------------------------------------------------- */

export interface ProfileFields {
  fullName: string;
  institution: string;
  faculty: string;
  department: string;
  programme: string;
  level: string;
  expectedGraduationYear: number | null;
  gradingSystemId: ID | null;
  termStructure: TermStructure;
  avatarDataUrl?: string | null;
}

export function saveProfile(userId: ID, fields: Partial<ProfileFields>): void {
  update((current) => ({
    ...current,
    profiles: current.profiles.map((profile) =>
      profile.userId === userId ? { ...profile, ...fields } : profile,
    ),
  }));
}

export function completeOnboarding(userId: ID): void {
  update((current) => ({
    ...current,
    profiles: current.profiles.map((profile) =>
      profile.userId === userId
        ? { ...profile, onboardingCompletedAt: profile.onboardingCompletedAt ?? nowIso() }
        : profile,
    ),
  }));
  trackEvent('onboarding_completed', userId);
}

export function savePreferences(userId: ID, patch: Partial<Preferences>): void {
  update((current) => ({
    ...current,
    preferences: {
      ...current.preferences,
      [userId]: { ...current.preferences[userId], ...patch } as Preferences,
    },
  }));
}

/* -------------------------------------------------------------------------- */
/* Grading systems                                                            */
/* -------------------------------------------------------------------------- */

export function createGradingSystem(
  userId: ID,
  name: string,
  scale: number,
  rules: Array<Omit<GradeRule, 'id'>>,
): GradingSystem {
  const system: GradingSystem = {
    id: uid('grd'),
    userId,
    name,
    scale,
    isPreset: false,
    rules: rules.map((rule) => ({ ...rule, id: uid('rule') })),
  };
  update((current) => ({ ...current, gradingSystems: [...current.gradingSystems, system] }));
  return system;
}

export function updateGradingSystem(
  userId: ID,
  systemId: ID,
  patch: Partial<Pick<GradingSystem, 'name' | 'scale'>> & { rules?: Array<Omit<GradeRule, 'id'>> },
): void {
  update((current) => ({
    ...current,
    gradingSystems: current.gradingSystems.map((system) => {
      if (system.id !== systemId || system.userId !== userId) return system;
      return {
        ...system,
        ...patch,
        rules: patch.rules
          ? patch.rules.map((rule) => ({ ...rule, id: uid('rule') }))
          : system.rules,
      };
    }),
  }));
}

export function deleteGradingSystem(userId: ID, systemId: ID): void {
  update((current) => ({
    ...current,
    gradingSystems: current.gradingSystems.filter(
      (system) => !(system.id === systemId && system.userId === userId),
    ),
    profiles: current.profiles.map((profile) =>
      profile.userId === userId && profile.gradingSystemId === systemId
        ? { ...profile, gradingSystemId: null }
        : profile,
    ),
  }));
}

/* -------------------------------------------------------------------------- */
/* Academic years & terms                                                     */
/* -------------------------------------------------------------------------- */

export function createAcademicYear(
  userId: ID,
  label: string,
  startYear: number,
  makeCurrent = true,
): AcademicYear {
  const year: AcademicYear = { id: uid('yr'), userId, label, startYear, isCurrent: makeCurrent };
  update((current) => ({
    ...current,
    academicYears: [
      ...current.academicYears.map((existing) =>
        existing.userId === userId && makeCurrent ? { ...existing, isCurrent: false } : existing,
      ),
      year,
    ],
  }));
  return year;
}

export function updateAcademicYear(
  userId: ID,
  yearId: ID,
  patch: Partial<Pick<AcademicYear, 'label' | 'startYear' | 'isCurrent'>>,
): void {
  update((current) => ({
    ...current,
    academicYears: current.academicYears.map((year) => {
      if (year.userId !== userId) return year;
      if (year.id === yearId) return { ...year, ...patch };
      return patch.isCurrent ? { ...year, isCurrent: false } : year;
    }),
  }));
}

/** Deletes a year with its terms, courses, topics and results. */
export function deleteAcademicYear(userId: ID, yearId: ID): void {
  const db = getDatabase();
  const termIds = new Set(
    db.terms.filter((term) => term.userId === userId && term.academicYearId === yearId).map((t) => t.id),
  );
  const courseIds = new Set(
    db.courses.filter((course) => termIds.has(course.termId)).map((course) => course.id),
  );

  update((current) => ({
    ...current,
    academicYears: current.academicYears.filter((year) => year.id !== yearId),
    terms: current.terms.filter((term) => !termIds.has(term.id)),
    courses: current.courses.filter((course) => !courseIds.has(course.id)),
    topics: current.topics.filter((topic) => !courseIds.has(topic.courseId)),
    results: current.results.filter((result) => !termIds.has(result.termId)),
    sessions: current.sessions.filter((session) => !courseIds.has(session.courseId)),
    events: current.events.filter((event) => !event.courseId || !courseIds.has(event.courseId)),
  }));
}

export function createTerm(
  userId: ID,
  academicYearId: ID,
  label: string,
  position: number,
  options: { startDate?: DateStr | null; endDate?: DateStr | null; makeCurrent?: boolean } = {},
): Term {
  const term: Term = {
    id: uid('trm'),
    userId,
    academicYearId,
    label,
    position,
    startDate: options.startDate ?? null,
    endDate: options.endDate ?? null,
    isCurrent: options.makeCurrent ?? false,
  };
  update((current) => ({
    ...current,
    terms: [
      ...current.terms.map((existing) =>
        existing.userId === userId && term.isCurrent ? { ...existing, isCurrent: false } : existing,
      ),
      term,
    ],
  }));
  return term;
}

export function updateTerm(userId: ID, termId: ID, patch: Partial<Term>): void {
  update((current) => ({
    ...current,
    terms: current.terms.map((term) => {
      if (term.userId !== userId) return term;
      if (term.id === termId) return { ...term, ...patch };
      return patch.isCurrent ? { ...term, isCurrent: false } : term;
    }),
  }));
}

export function deleteTerm(userId: ID, termId: ID): void {
  const db = getDatabase();
  const courseIds = new Set(
    db.courses.filter((course) => course.userId === userId && course.termId === termId).map((c) => c.id),
  );
  update((current) => ({
    ...current,
    terms: current.terms.filter((term) => term.id !== termId),
    courses: current.courses.filter((course) => !courseIds.has(course.id)),
    topics: current.topics.filter((topic) => !courseIds.has(topic.courseId)),
    results: current.results.filter((result) => result.termId !== termId),
    sessions: current.sessions.filter((session) => !courseIds.has(session.courseId)),
  }));
}

/* -------------------------------------------------------------------------- */
/* Courses & topics                                                           */
/* -------------------------------------------------------------------------- */

export interface CourseFields {
  termId: ID;
  name: string;
  code: string;
  units: number;
  priority: Priority;
  examDate: DateStr | null;
  description: string | null;
}

export function createCourse(userId: ID, fields: CourseFields): Course {
  const course: Course = {
    id: uid('crs'),
    userId,
    archived: false,
    createdAt: nowIso(),
    ...fields,
  };
  update((current) => ({ ...current, courses: [...current.courses, course] }));
  trackEvent('course_created', userId);
  return course;
}

export function updateCourse(userId: ID, courseId: ID, patch: Partial<CourseFields>): void {
  update((current) => ({
    ...current,
    courses: current.courses.map((course) =>
      course.id === courseId && course.userId === userId ? { ...course, ...patch } : course,
    ),
  }));
}

export function setCourseArchived(userId: ID, courseId: ID, archived: boolean): void {
  update((current) => ({
    ...current,
    courses: current.courses.map((course) =>
      course.id === courseId && course.userId === userId ? { ...course, archived } : course,
    ),
  }));
}

export function deleteCourse(userId: ID, courseId: ID): void {
  update((current) => ({
    ...current,
    courses: current.courses.filter(
      (course) => !(course.id === courseId && course.userId === userId),
    ),
    topics: current.topics.filter((topic) => topic.courseId !== courseId),
    sessions: current.sessions.filter((session) => session.courseId !== courseId),
    events: current.events.map((event) =>
      event.courseId === courseId ? { ...event, courseId: null } : event,
    ),
    tasks: current.tasks.map((task) =>
      task.courseId === courseId ? { ...task, courseId: null } : task,
    ),
  }));
}

export function addTopics(
  userId: ID,
  courseId: ID,
  titles: string[],
  defaults: { difficulty?: Difficulty; estimatedMinutes?: number } = {},
): CourseTopic[] {
  const existing = getDatabase().topics.filter((topic) => topic.courseId === courseId);
  const created = titles
    .map((title) => title.trim())
    .filter(Boolean)
    .map((title, index) => ({
      id: uid('top'),
      userId,
      courseId,
      title,
      position: existing.length + index + 1,
      difficulty: defaults.difficulty ?? 'NORMAL',
      estimatedMinutes: defaults.estimatedMinutes ?? 60,
      completedMinutes: 0,
      done: false,
    }));

  if (created.length === 0) return [];
  update((current) => ({ ...current, topics: [...current.topics, ...created] }));
  return created;
}

export function updateTopic(userId: ID, topicId: ID, patch: Partial<CourseTopic>): void {
  update((current) => ({
    ...current,
    topics: current.topics.map((topic) =>
      topic.id === topicId && topic.userId === userId ? { ...topic, ...patch } : topic,
    ),
  }));
}

export function deleteTopic(userId: ID, topicId: ID): void {
  update((current) => ({
    ...current,
    topics: current.topics.filter((topic) => !(topic.id === topicId && topic.userId === userId)),
    sessions: current.sessions.map((session) =>
      session.topicId === topicId ? { ...session, topicId: null } : session,
    ),
  }));
}

/** Moves a topic up or down within its course and renumbers positions. */
export function moveTopic(userId: ID, topicId: ID, direction: -1 | 1): void {
  const db = getDatabase();
  const topic = db.topics.find((t) => t.id === topicId && t.userId === userId);
  if (!topic) return;

  const siblings = db.topics
    .filter((t) => t.courseId === topic.courseId)
    .sort((a, b) => a.position - b.position);
  const index = siblings.findIndex((t) => t.id === topicId);
  const target = index + direction;
  if (target < 0 || target >= siblings.length) return;

  const reordered = [...siblings];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  const positions = new Map(reordered.map((t, i) => [t.id, i + 1]));

  update((current) => ({
    ...current,
    topics: current.topics.map((t) =>
      positions.has(t.id) ? { ...t, position: positions.get(t.id) as number } : t,
    ),
  }));
}

/* -------------------------------------------------------------------------- */
/* Results                                                                    */
/* -------------------------------------------------------------------------- */

export interface ResultFields {
  termId: ID;
  courseId: ID | null;
  courseName: string;
  courseCode: string;
  units: number;
  gradeName: string;
  gradePoint: number;
  countsInGpa: boolean;
  isRepeat: boolean;
  replacesResultId: ID | null;
}

export function addResult(userId: ID, fields: ResultFields): Result {
  const result: Result = { id: uid('res'), userId, createdAt: nowIso(), ...fields };
  update((current) => ({ ...current, results: [...current.results, result] }));
  trackEvent('result_recorded', userId);
  return result;
}

export function updateResult(userId: ID, resultId: ID, patch: Partial<ResultFields>): void {
  update((current) => ({
    ...current,
    results: current.results.map((result) =>
      result.id === resultId && result.userId === userId ? { ...result, ...patch } : result,
    ),
  }));
}

export function deleteResult(userId: ID, resultId: ID): void {
  update((current) => ({
    ...current,
    results: current.results.filter(
      (result) => !(result.id === resultId && result.userId === userId),
    ),
  }));
}

/* -------------------------------------------------------------------------- */
/* Events, tasks, availability                                                */
/* -------------------------------------------------------------------------- */

export function createEvent(userId: ID, fields: Omit<AcademicEvent, 'id' | 'userId'>): AcademicEvent {
  const event: AcademicEvent = { id: uid('evt'), userId, ...fields };
  update((current) => ({ ...current, events: [...current.events, event] }));
  return event;
}

export function updateEvent(userId: ID, eventId: ID, patch: Partial<AcademicEvent>): void {
  update((current) => ({
    ...current,
    events: current.events.map((event) =>
      event.id === eventId && event.userId === userId ? { ...event, ...patch } : event,
    ),
  }));
}

export function deleteEvent(userId: ID, eventId: ID): void {
  update((current) => ({
    ...current,
    events: current.events.filter((event) => !(event.id === eventId && event.userId === userId)),
  }));
}

export function createTask(
  userId: ID,
  fields: Omit<Task, 'id' | 'userId' | 'status' | 'createdAt'>,
): Task {
  const task: Task = { id: uid('tsk'), userId, status: 'TODO', createdAt: nowIso(), ...fields };
  update((current) => ({ ...current, tasks: [...current.tasks, task] }));
  return task;
}

export function toggleTask(userId: ID, taskId: ID): void {
  update((current) => ({
    ...current,
    tasks: current.tasks.map((task) =>
      task.id === taskId && task.userId === userId
        ? { ...task, status: task.status === 'DONE' ? 'TODO' : 'DONE' }
        : task,
    ),
  }));
}

export function deleteTask(userId: ID, taskId: ID): void {
  update((current) => ({
    ...current,
    tasks: current.tasks.filter((task) => !(task.id === taskId && task.userId === userId)),
  }));
}

export function addAvailability(
  userId: ID,
  weekday: Weekday,
  startTime: string,
  endTime: string,
): AvailabilitySlot | null {
  if (toMinutes(endTime) <= toMinutes(startTime)) return null;
  const slot: AvailabilitySlot = { id: uid('avl'), userId, weekday, startTime, endTime };
  update((current) => ({ ...current, availability: [...current.availability, slot] }));
  return slot;
}

export function deleteAvailability(userId: ID, slotId: ID): void {
  update((current) => ({
    ...current,
    availability: current.availability.filter(
      (slot) => !(slot.id === slotId && slot.userId === userId),
    ),
  }));
}

/** Copies one day's availability to every other day of the week. */
export function copyAvailabilityToAllDays(userId: ID, weekday: Weekday): void {
  const db = getDatabase();
  const source = db.availability.filter(
    (slot) => slot.userId === userId && slot.weekday === weekday,
  );
  if (source.length === 0) return;

  const clones: AvailabilitySlot[] = [];
  for (let day = 0; day <= 6; day += 1) {
    if (day === weekday) continue;
    for (const slot of source) {
      clones.push({ ...slot, id: uid('avl'), weekday: day as Weekday });
    }
  }

  update((current) => ({
    ...current,
    availability: [
      ...current.availability.filter((slot) => slot.userId !== userId || slot.weekday === weekday),
      ...clones,
    ],
  }));
}

/* -------------------------------------------------------------------------- */
/* Study sessions & the planner                                               */
/* -------------------------------------------------------------------------- */

export function createSession(
  userId: ID,
  fields: Omit<StudySession, 'id' | 'userId' | 'status' | 'generated' | 'completedAt' | 'durationMinutes'>,
): StudySession {
  const duration = toMinutes(fields.endTime) - toMinutes(fields.startTime);
  const session: StudySession = {
    id: uid('ses'),
    userId,
    status: 'SCHEDULED',
    generated: false,
    completedAt: null,
    durationMinutes: Math.max(0, duration),
    ...fields,
  };
  update((current) => ({ ...current, sessions: [...current.sessions, session] }));
  return session;
}

export function completeSession(userId: ID, sessionId: ID): void {
  const db = getDatabase();
  const session = db.sessions.find((s) => s.id === sessionId && s.userId === userId);
  if (!session || session.status === 'COMPLETED') return;

  update((current) => ({
    ...current,
    sessions: current.sessions.map((s) =>
      s.id === sessionId ? { ...s, status: 'COMPLETED', completedAt: nowIso() } : s,
    ),
    topics: current.topics.map((topic) => {
      if (topic.id !== session.topicId) return topic;
      const completedMinutes = topic.completedMinutes + session.durationMinutes;
      return {
        ...topic,
        completedMinutes,
        done: completedMinutes >= topic.estimatedMinutes,
      };
    }),
  }));
  trackEvent('session_completed', userId);
}

export function skipSession(userId: ID, sessionId: ID): void {
  update((current) => ({
    ...current,
    sessions: current.sessions.map((session) =>
      session.id === sessionId && session.userId === userId
        ? { ...session, status: 'SKIPPED' }
        : session,
    ),
  }));
  trackEvent('session_skipped', userId);
}

/** Marks a session rescheduled and creates its replacement. */
export function rescheduleSession(
  userId: ID,
  sessionId: ID,
  date: DateStr,
  startTime: string,
  endTime: string,
): void {
  const db = getDatabase();
  const session = db.sessions.find((s) => s.id === sessionId && s.userId === userId);
  if (!session) return;

  const replacement: StudySession = {
    ...session,
    id: uid('ses'),
    date,
    startTime,
    endTime,
    durationMinutes: Math.max(0, toMinutes(endTime) - toMinutes(startTime)),
    status: 'SCHEDULED',
    completedAt: null,
  };

  update((current) => ({
    ...current,
    sessions: [
      ...current.sessions.map((s) =>
        s.id === sessionId ? { ...s, status: 'RESCHEDULED' as const } : s,
      ),
      replacement,
    ],
  }));
}

export function deleteSession(userId: ID, sessionId: ID): void {
  update((current) => ({
    ...current,
    sessions: current.sessions.filter(
      (session) => !(session.id === sessionId && session.userId === userId),
    ),
  }));
}

export interface GeneratePlanOptions extends Omit<PlannerConfig, 'startDate'> {
  startDate?: DateStr;
  replaceExisting: boolean;
}

export function generatePlan(userId: ID, options: GeneratePlanOptions) {
  const db = getDatabase();
  const startDate = options.startDate ?? todayStr();

  const kept = options.replaceExisting
    ? db.sessions.filter(
        (session) =>
          session.userId !== userId ||
          !session.generated ||
          session.status !== 'SCHEDULED' ||
          session.date < startDate,
      )
    : db.sessions;

  const result = generateStudyPlan({
    userId,
    courses: db.courses.filter((course) => course.userId === userId),
    topics: db.topics.filter((topic) => topic.userId === userId),
    events: db.events.filter((event) => event.userId === userId),
    availability: db.availability.filter((slot) => slot.userId === userId),
    existingSessions: kept.filter((session) => session.userId === userId),
    config: {
      startDate,
      horizonDays: options.horizonDays,
      sessionMinutes: options.sessionMinutes,
      breakMinutes: options.breakMinutes,
      maxMinutesPerDay: options.maxMinutesPerDay,
      maxSessionsPerCoursePerDay: options.maxSessionsPerCoursePerDay,
    },
  });

  const withIds = result.sessions.map((session) => ({ ...session, id: uid('ses') }));
  // `kept` already excludes the regenerated sessions and preserves every other row.
  update((current) => ({ ...current, sessions: [...kept, ...withIds] }));

  if (withIds.length > 0) trackEvent('plan_generated', userId);
  return { ...result, sessions: withIds };
}

/* -------------------------------------------------------------------------- */
/* Goals                                                                      */
/* -------------------------------------------------------------------------- */

export function createGoal(userId: ID, fields: Omit<Goal, 'id' | 'userId' | 'createdAt' | 'achievedAt'>): Goal {
  const goal: Goal = { id: uid('gol'), userId, createdAt: nowIso(), achievedAt: null, ...fields };
  update((current) => ({ ...current, goals: [...current.goals, goal] }));
  return goal;
}

export function setGoalAchieved(userId: ID, goalId: ID, achieved: boolean): void {
  update((current) => ({
    ...current,
    goals: current.goals.map((goal) =>
      goal.id === goalId && goal.userId === userId
        ? { ...goal, achievedAt: achieved ? (goal.achievedAt ?? nowIso()) : null }
        : goal,
    ),
  }));
}

export function deleteGoal(userId: ID, goalId: ID): void {
  update((current) => ({
    ...current,
    goals: current.goals.filter((goal) => !(goal.id === goalId && goal.userId === userId)),
  }));
}

/* -------------------------------------------------------------------------- */
/* Sharing                                                                    */
/* -------------------------------------------------------------------------- */

export function createSnapshot(
  userId: ID,
  fields: ShareField[],
  payload: Record<string, string | number>,
  expiresInDays: number | null,
): ShareSnapshot {
  const token = uid('shr').replace('shr_', '');
  const snapshot: ShareSnapshot = {
    id: uid('snp'),
    userId,
    token,
    fields,
    payload,
    expiresAt: expiresInDays
      ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString()
      : null,
    revokedAt: null,
    createdAt: nowIso(),
    views: 0,
  };
  update((current) => ({ ...current, snapshots: [...current.snapshots, snapshot] }));
  trackEvent('snapshot_created', userId);
  return snapshot;
}

export function revokeSnapshot(userId: ID, snapshotId: ID): void {
  update((current) => ({
    ...current,
    snapshots: current.snapshots.map((snapshot) =>
      snapshot.id === snapshotId && snapshot.userId === userId
        ? { ...snapshot, revokedAt: nowIso() }
        : snapshot,
    ),
  }));
}

export function deleteSnapshot(userId: ID, snapshotId: ID): void {
  update((current) => ({
    ...current,
    snapshots: current.snapshots.filter(
      (snapshot) => !(snapshot.id === snapshotId && snapshot.userId === userId),
    ),
  }));
}

export type SnapshotLookup =
  | { status: 'OK'; snapshot: ShareSnapshot }
  | { status: 'NOT_FOUND' }
  | { status: 'REVOKED' }
  | { status: 'EXPIRED' };

/** Public lookup: only the selected fields are ever exposed. */
export function findSnapshotByToken(token: string): SnapshotLookup {
  const snapshot = getDatabase().snapshots.find((s) => s.token === token);
  if (!snapshot) return { status: 'NOT_FOUND' };
  if (snapshot.revokedAt) return { status: 'REVOKED' };
  if (snapshot.expiresAt && snapshot.expiresAt < nowIso()) return { status: 'EXPIRED' };
  return { status: 'OK', snapshot };
}

export function recordSnapshotView(token: string): void {
  update((current) => ({
    ...current,
    snapshots: current.snapshots.map((snapshot) =>
      snapshot.token === token ? { ...snapshot, views: snapshot.views + 1 } : snapshot,
    ),
  }));
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                              */
/* -------------------------------------------------------------------------- */

export function pushNotification(
  userId: ID,
  notification: Pick<AppNotification, 'title' | 'body' | 'kind'>,
): void {
  const row: AppNotification = {
    id: uid('ntf'),
    userId,
    readAt: null,
    createdAt: nowIso(),
    ...notification,
  };
  update((current) => ({
    ...current,
    notifications: [row, ...current.notifications].slice(0, 100),
  }));
}

export function markNotificationRead(userId: ID, notificationId: ID): void {
  update((current) => ({
    ...current,
    notifications: current.notifications.map((notification) =>
      notification.id === notificationId && notification.userId === userId
        ? { ...notification, readAt: notification.readAt ?? nowIso() }
        : notification,
    ),
  }));
}

export function markAllNotificationsRead(userId: ID): void {
  update((current) => ({
    ...current,
    notifications: current.notifications.map((notification) =>
      notification.userId === userId
        ? { ...notification, readAt: notification.readAt ?? nowIso() }
        : notification,
    ),
  }));
}

/* -------------------------------------------------------------------------- */
/* Feedback                                                                   */
/* -------------------------------------------------------------------------- */

export function submitFeedback(
  userId: ID | null,
  userEmail: string | null,
  category: Feedback['category'],
  message: string,
): Feedback {
  const feedback: Feedback = {
    id: uid('fbk'),
    userId,
    userEmail,
    category,
    message: message.trim(),
    status: 'OPEN',
    createdAt: nowIso(),
  };
  update((current) => ({ ...current, feedback: [feedback, ...current.feedback] }));
  return feedback;
}

/* -------------------------------------------------------------------------- */
/* Admin (owner-only; the API re-checks the role on every request)            */
/* -------------------------------------------------------------------------- */

function logAdminAction(adminEmail: string, action: string, resource: string): void {
  update((current) => ({
    ...current,
    activityLogs: [
      { id: uid('log'), adminEmail, action, resource, createdAt: nowIso() },
      ...current.activityLogs,
    ].slice(0, 500),
  }));
}

export function setUserStatus(
  adminEmail: string,
  userId: ID,
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED',
): void {
  update((current) => ({
    ...current,
    users: current.users.map((user) => (user.id === userId ? { ...user, status } : user)),
    sessionUserId:
      status !== 'ACTIVE' && current.sessionUserId === userId ? null : current.sessionUserId,
  }));
  const action =
    status === 'ACTIVE' ? 'Restored user' : status === 'SUSPENDED' ? 'Suspended user' : 'Deleted user';
  logAdminAction(adminEmail, action, userId);
}

export function updateFeedbackStatus(
  adminEmail: string,
  feedbackId: ID,
  status: FeedbackStatus,
): void {
  update((current) => ({
    ...current,
    feedback: current.feedback.map((item) =>
      item.id === feedbackId ? { ...item, status } : item,
    ),
  }));
  logAdminAction(adminEmail, `Set feedback to ${status}`, feedbackId);
}

export function createAnnouncement(adminEmail: string, title: string, body: string): Announcement {
  const announcement: Announcement = {
    id: uid('ann'),
    title,
    body,
    status: 'DRAFT',
    createdAt: nowIso(),
    publishedAt: null,
  };
  update((current) => ({ ...current, announcements: [announcement, ...current.announcements] }));
  logAdminAction(adminEmail, 'Created announcement', announcement.id);
  return announcement;
}

export function updateAnnouncement(
  adminEmail: string,
  announcementId: ID,
  patch: Partial<Pick<Announcement, 'title' | 'body' | 'status'>>,
): void {
  update((current) => ({
    ...current,
    announcements: current.announcements.map((announcement) =>
      announcement.id === announcementId
        ? {
            ...announcement,
            ...patch,
            publishedAt:
              patch.status === 'PUBLISHED'
                ? (announcement.publishedAt ?? nowIso())
                : patch.status
                  ? null
                  : announcement.publishedAt,
          }
        : announcement,
    ),
  }));
  logAdminAction(adminEmail, `Updated announcement${patch.status ? ` → ${patch.status}` : ''}`, announcementId);
}

export function deleteAnnouncement(adminEmail: string, announcementId: ID): void {
  update((current) => ({
    ...current,
    announcements: current.announcements.filter((a) => a.id !== announcementId),
  }));
  logAdminAction(adminEmail, 'Deleted announcement', announcementId);
}

export function setFeatureFlag(
  adminEmail: string,
  flag: keyof FeatureFlags,
  value: boolean,
): void {
  update((current) => ({
    ...current,
    featureFlags: { ...current.featureFlags, [flag]: value },
  }));
  logAdminAction(adminEmail, `Set ${flag} to ${value ? 'ON' : 'OFF'}`, 'feature-flags');
}
