/**
 * Zod schemas shared between the client (instant validation feedback) and the
 * API (mandatory server-side validation). The server never trusts a payload,
 * a user id, an ownership claim, a grade value or a unit count.
 */

import { z } from 'zod';

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

export const idSchema = z.string().min(1).max(64);
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use the format HH:mm');

export const emailSchema = trimmed(3, 254).email('Enter a valid email address');
export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'Password is too long');

export const prioritySchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export const difficultySchema = z.enum(['EASY', 'NORMAL', 'HARD']);

/* -------------------------------- auth ---------------------------------- */

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: trimmed(2, 80),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password'),
});

export const requestResetSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: trimmed(10, 200),
  password: passwordSchema,
});

/* ------------------------------- grading -------------------------------- */

export const gradeRuleSchema = z.object({
  id: idSchema.optional(),
  name: trimmed(1, 8),
  point: z.number().min(0).max(100),
  minScore: z.number().min(0).max(100).nullable().default(null),
});

export const gradingSystemSchema = z.object({
  name: trimmed(2, 60),
  scale: z.number().min(1).max(100),
  rules: z.array(gradeRuleSchema).min(2, 'Define at least two grades'),
});

/* ------------------------------- profile -------------------------------- */

export const profileSchema = z.object({
  fullName: trimmed(2, 80),
  institution: trimmed(2, 120),
  faculty: trimmed(0, 120).default(''),
  department: trimmed(0, 120).default(''),
  programme: trimmed(0, 120).default(''),
  level: trimmed(0, 40).default(''),
  expectedGraduationYear: z
    .number()
    .int()
    .min(1980)
    .max(2100)
    .nullable()
    .default(null),
  termStructure: z.enum(['SEMESTER', 'TRIMESTER', 'QUARTER', 'CUSTOM']).default('SEMESTER'),
  gradingSystemId: idSchema.nullable().default(null),
  avatarDataUrl: z.string().max(400_000).nullable().default(null),
});

/* --------------------------- academic structure -------------------------- */

export const academicYearSchema = z.object({
  label: trimmed(4, 20),
  startYear: z.number().int().min(1980).max(2100),
  isCurrent: z.boolean().default(false),
});

export const termSchema = z.object({
  academicYearId: idSchema,
  label: trimmed(2, 40),
  position: z.number().int().min(1).max(12).default(1),
  startDate: dateSchema.nullable().default(null),
  endDate: dateSchema.nullable().default(null),
  isCurrent: z.boolean().default(false),
});

/* -------------------------------- courses ------------------------------- */

export const courseSchema = z.object({
  termId: idSchema,
  name: trimmed(2, 120),
  code: trimmed(0, 24).default(''),
  units: z.number().min(0.5, 'Units must be greater than 0').max(30),
  priority: prioritySchema.default('MEDIUM'),
  examDate: dateSchema.nullable().default(null),
  description: trimmed(0, 500).nullable().default(null),
});

export const topicSchema = z.object({
  courseId: idSchema,
  title: trimmed(1, 160),
  difficulty: difficultySchema.default('NORMAL'),
  estimatedMinutes: z.number().int().min(15).max(1200).default(60),
});

/* -------------------------------- results ------------------------------- */

export const resultSchema = z.object({
  termId: idSchema,
  courseId: idSchema.nullable().default(null),
  courseName: trimmed(1, 120),
  courseCode: trimmed(0, 24).default(''),
  units: z.number().min(0.5).max(30),
  gradeName: trimmed(1, 8),
  countsInGpa: z.boolean().default(true),
  isRepeat: z.boolean().default(false),
  replacesResultId: idSchema.nullable().default(null),
});

/* -------------------------------- planner ------------------------------- */

export const eventSchema = z.object({
  courseId: idSchema.nullable().default(null),
  type: z.enum(['EXAM', 'TEST', 'ASSIGNMENT', 'OTHER']).default('EXAM'),
  title: trimmed(2, 120),
  date: dateSchema,
  startTime: timeSchema.nullable().default(null),
  endTime: timeSchema.nullable().default(null),
  notes: trimmed(0, 500).nullable().default(null),
});

export const taskSchema = z.object({
  courseId: idSchema.nullable().default(null),
  title: trimmed(2, 160),
  dueDate: dateSchema.nullable().default(null),
  priority: prioritySchema.default('MEDIUM'),
});

export const availabilitySchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startTime: timeSchema,
    endTime: timeSchema,
  })
  .refine((slot) => slot.endTime > slot.startTime, {
    message: 'End time must be after start time',
    path: ['endTime'],
  });

export const studySessionSchema = z
  .object({
    courseId: idSchema,
    topicId: idSchema.nullable().default(null),
    date: dateSchema,
    startTime: timeSchema,
    endTime: timeSchema,
  })
  .refine((session) => session.endTime > session.startTime, {
    message: 'End time must be after start time',
    path: ['endTime'],
  });

export const generatePlanSchema = z.object({
  startDate: dateSchema.optional(),
  horizonDays: z.number().int().min(1).max(60).default(14),
  sessionMinutes: z.number().int().min(30).max(180).default(60),
  breakMinutes: z.number().int().min(0).max(60).default(15),
  maxMinutesPerDay: z.number().int().min(30).max(720).default(240),
  maxSessionsPerCoursePerDay: z.number().int().min(1).max(6).default(1),
  /** Replaces existing generated, not-yet-completed sessions. */
  replaceExisting: z.boolean().default(true),
});

/* --------------------------- goals & guest GPA -------------------------- */

export const goalSchema = z.object({
  type: z.enum(['TARGET_CGPA', 'TARGET_GPA', 'SESSIONS', 'STREAK']),
  title: trimmed(2, 120),
  targetValue: z.number().min(0).max(1000),
  termId: idSchema.nullable().default(null),
  dueDate: dateSchema.nullable().default(null),
});

export const guestCourseSchema = z.object({
  name: trimmed(0, 120).default(''),
  units: z.number().min(0.5, 'Units must be greater than 0').max(30),
  gradeName: trimmed(1, 8),
});

export const targetCalculatorSchema = z.object({
  currentCgpa: z.number().min(0).max(100),
  completedUnits: z.number().min(0).max(1000),
  targetCgpa: z.number().min(0).max(100),
  remainingUnits: z.number().min(0).max(1000),
});

/* ------------------------------- sharing -------------------------------- */

export const shareFieldSchema = z.enum([
  'fullName',
  'institution',
  'programme',
  'level',
  'cgpa',
  'termGpa',
  'completedUnits',
  'streak',
]);

export const shareSnapshotSchema = z.object({
  fields: z.array(shareFieldSchema).min(1, 'Select at least one field'),
  expiresInDays: z.number().int().min(1).max(90).nullable().default(7),
});

/* ------------------------------- feedback ------------------------------- */

export const feedbackSchema = z.object({
  category: z.enum(['BUG', 'FEATURE_REQUEST', 'GENERAL_FEEDBACK']),
  message: trimmed(10, 2000),
});

export const feedbackStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);

/* --------------------------------- admin -------------------------------- */

export const announcementSchema = z.object({
  title: trimmed(2, 120),
  body: trimmed(2, 1000),
});

export const featureFlagsSchema = z.object({
  gpaCalculatorEnabled: z.boolean(),
  gpaProjectionEnabled: z.boolean(),
  plannerEnabled: z.boolean(),
  goalsEnabled: z.boolean(),
  streaksEnabled: z.boolean(),
  sharingEnabled: z.boolean(),
  notificationsEnabled: z.boolean(),
});

/* -------------------------- guest → account import ----------------------- */

/**
 * A guest's local data, handed to the server once they create an account.
 *
 * References between rows use the guest's own local ids (`localId`), which the
 * server rewrites to real UUIDs as it inserts. Nothing here is trusted: every
 * row is re-validated by the same schemas the normal endpoints use, and the
 * caps below bound how much work one request can ask for.
 */
export const importBundleSchema = z.object({
  profile: profileSchema.partial().optional(),
  gradingSystem: gradingSystemSchema.optional(),
  academicYears: z.array(academicYearSchema.extend({ localId: idSchema })).max(20).default([]),
  terms: z.array(termSchema.extend({ localId: idSchema })).max(80).default([]),
  courses: z.array(courseSchema.extend({ localId: idSchema })).max(300).default([]),
  topics: z.array(topicSchema.extend({ localId: idSchema })).max(3000).default([]),
  results: z.array(resultSchema).max(600).default([]),
  events: z.array(eventSchema).max(400).default([]),
  tasks: z.array(taskSchema).max(400).default([]),
  availability: z.array(availabilitySchema).max(60).default([]),
  goals: z.array(goalSchema).max(50).default([]),
});

export type ImportBundle = z.infer<typeof importBundleSchema>;

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ProfileInput = z.infer<typeof profileSchema>;
export type CourseInput = z.infer<typeof courseSchema>;
export type TopicInput = z.infer<typeof topicSchema>;
export type ResultInput = z.infer<typeof resultSchema>;
export type EventInput = z.infer<typeof eventSchema>;
export type TaskInput = z.infer<typeof taskSchema>;
export type AvailabilityInput = z.infer<typeof availabilitySchema>;
export type StudySessionInput = z.infer<typeof studySessionSchema>;
export type GeneratePlanInput = z.infer<typeof generatePlanSchema>;
export type GoalInput = z.infer<typeof goalSchema>;
export type ShareSnapshotInput = z.infer<typeof shareSnapshotSchema>;
export type FeedbackInput = z.infer<typeof feedbackSchema>;
export type AnnouncementInput = z.infer<typeof announcementSchema>;
export type AcademicYearInput = z.infer<typeof academicYearSchema>;
export type TermInput = z.infer<typeof termSchema>;
export type GradingSystemInput = z.infer<typeof gradingSystemSchema>;

/* ---------------------------------- sync ---------------------------------- */

/** The collections a device is allowed to sync. Anything else is rejected. */
export const SYNC_COLLECTIONS = [
  'gradingSystems',
  'academicYears',
  'terms',
  'courses',
  'topics',
  'results',
  'events',
  'tasks',
  'availability',
  'sessions',
  'goals',
  'snapshots',
  'notifications',
  'feedback',
] as const;

const uuidSchema = z.string().uuid();

export const syncRowSchema = z.object({
  collection: z.enum(SYNC_COLLECTIONS),
  id: uuidSchema,
  /**
   * The row as the client stores it. Deliberately opaque — the server replicates
   * academic data, it does not interpret it — but capped so one device cannot
   * push an unbounded document.
   */
  data: z.record(z.unknown()),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().default(null),
});

export const syncRequestSchema = z.object({
  /**
   * When this device last completed a sync. The server returns everything that
   * changed after it; null asks for the whole account, which is what a new
   * device needs.
   */
  since: z.string().datetime().nullable(),
  /**
   * Rows this device has that the server may not. Bounded so a first sync of a
   * long history arrives in batches rather than one request that times out.
   */
  rows: z.array(syncRowSchema).max(500),
});

export type SyncRowInput = z.infer<typeof syncRowSchema>;
export type SyncRequestInput = z.infer<typeof syncRequestSchema>;


