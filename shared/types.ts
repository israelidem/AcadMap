/**
 * AcadMap shared domain types.
 *
 * These types are shared between the React client and the API functions so the
 * same contract (and the same calculation engines) is used on both sides.
 */

export type ID = string;

/** ISO date string, `YYYY-MM-DD`. */
export type DateStr = string;
/** 24h time string, `HH:mm`. */
export type TimeStr = string;
/** ISO timestamp. */
export type Timestamp = string;

/* -------------------------------------------------------------------------- */
/* Users & profile                                                            */
/* -------------------------------------------------------------------------- */

export type UserRole = 'STUDENT' | 'OWNER';
export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';

export interface User {
  id: ID;
  email: string;
  role: UserRole;
  status: AccountStatus;
  createdAt: Timestamp;
  lastActiveAt: Timestamp;
}

export interface Profile {
  userId: ID;
  fullName: string;
  institution: string;
  faculty: string;
  department: string;
  programme: string;
  level: string;
  expectedGraduationYear: number | null;
  avatarDataUrl: string | null;
  gradingSystemId: ID | null;
  termStructure: TermStructure;
  onboardingCompletedAt: Timestamp | null;
}

/** Academic structures are configurable — never hard-code "two semesters". */
export type TermStructure = 'SEMESTER' | 'TRIMESTER' | 'QUARTER' | 'CUSTOM';

/* -------------------------------------------------------------------------- */
/* Grading                                                                    */
/* -------------------------------------------------------------------------- */

export interface GradeRule {
  id: ID;
  /** Grade label, e.g. `A`, `B+`, `Pass`. */
  name: string;
  /** Grade point awarded, e.g. `5`. */
  point: number;
  /** Optional minimum score for score-based entry. */
  minScore: number | null;
}

export interface GradingSystem {
  id: ID;
  userId: ID | null;
  name: string;
  /** Maximum attainable grade point, e.g. 4 or 5. */
  scale: number;
  isPreset: boolean;
  rules: GradeRule[];
}

/* -------------------------------------------------------------------------- */
/* Academic structure                                                         */
/* -------------------------------------------------------------------------- */

export interface AcademicYear {
  id: ID;
  userId: ID;
  /** e.g. `2026/2027` */
  label: string;
  startYear: number;
  isCurrent: boolean;
}

export interface Term {
  id: ID;
  userId: ID;
  academicYearId: ID;
  /** e.g. `First Semester`, `Trimester 2` */
  label: string;
  /** Ordering within the academic year. */
  position: number;
  startDate: DateStr | null;
  endDate: DateStr | null;
  isCurrent: boolean;
}

/* -------------------------------------------------------------------------- */
/* Courses & topics                                                           */
/* -------------------------------------------------------------------------- */

export type Priority = 'HIGH' | 'MEDIUM' | 'LOW';
export type Difficulty = 'EASY' | 'NORMAL' | 'HARD';

export interface Course {
  id: ID;
  userId: ID;
  termId: ID;
  name: string;
  code: string;
  units: number;
  priority: Priority;
  examDate: DateStr | null;
  description: string | null;
  archived: boolean;
  createdAt: Timestamp;
}

export interface CourseTopic {
  id: ID;
  userId: ID;
  courseId: ID;
  title: string;
  position: number;
  difficulty: Difficulty;
  /** Planned workload in minutes. */
  estimatedMinutes: number;
  /** Minutes already studied through completed sessions. */
  completedMinutes: number;
  done: boolean;
}

/* -------------------------------------------------------------------------- */
/* Results                                                                    */
/* -------------------------------------------------------------------------- */

export interface Result {
  id: ID;
  userId: ID;
  termId: ID;
  courseId: ID | null;
  /** Snapshot of the course identity so results survive course deletion. */
  courseName: string;
  courseCode: string;
  units: number;
  gradeName: string;
  gradePoint: number;
  /** Excluded from GPA when false (e.g. pass/fail or audited courses). */
  countsInGpa: boolean;
  isRepeat: boolean;
  /** When a repeat replaces an earlier attempt, that attempt is excluded. */
  replacesResultId: ID | null;
  createdAt: Timestamp;
}

/* -------------------------------------------------------------------------- */
/* Planner                                                                    */
/* -------------------------------------------------------------------------- */

export type EventType = 'EXAM' | 'TEST' | 'ASSIGNMENT' | 'OTHER';

export interface AcademicEvent {
  id: ID;
  userId: ID;
  courseId: ID | null;
  type: EventType;
  title: string;
  date: DateStr;
  startTime: TimeStr | null;
  endTime: TimeStr | null;
  notes: string | null;
}

export type TaskStatus = 'TODO' | 'DONE';

export interface Task {
  id: ID;
  userId: ID;
  courseId: ID | null;
  title: string;
  dueDate: DateStr | null;
  priority: Priority;
  status: TaskStatus;
  createdAt: Timestamp;
}

/** 0 = Sunday … 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface AvailabilitySlot {
  id: ID;
  userId: ID;
  weekday: Weekday;
  startTime: TimeStr;
  endTime: TimeStr;
}

export type SessionStatus = 'SCHEDULED' | 'COMPLETED' | 'SKIPPED' | 'RESCHEDULED';

export interface StudySession {
  id: ID;
  userId: ID;
  courseId: ID;
  topicId: ID | null;
  date: DateStr;
  startTime: TimeStr;
  endTime: TimeStr;
  durationMinutes: number;
  status: SessionStatus;
  /** True when produced by the automatic planner. */
  generated: boolean;
  completedAt: Timestamp | null;
}

/* -------------------------------------------------------------------------- */
/* Goals, streaks, sharing, notifications, feedback                           */
/* -------------------------------------------------------------------------- */

export type GoalType = 'TARGET_CGPA' | 'TARGET_GPA' | 'SESSIONS' | 'STREAK';

export interface Goal {
  id: ID;
  userId: ID;
  type: GoalType;
  title: string;
  targetValue: number;
  termId: ID | null;
  dueDate: DateStr | null;
  achievedAt: Timestamp | null;
  createdAt: Timestamp;
}

export interface StreakState {
  current: number;
  longest: number;
  lastQualifyingDay: DateStr | null;
}

export interface ShareSnapshot {
  id: ID;
  userId: ID;
  token: string;
  fields: ShareField[];
  payload: Record<string, string | number>;
  expiresAt: Timestamp | null;
  revokedAt: Timestamp | null;
  createdAt: Timestamp;
  views: number;
}

export type ShareField =
  | 'fullName'
  | 'institution'
  | 'programme'
  | 'level'
  | 'cgpa'
  | 'termGpa'
  | 'completedUnits'
  | 'streak';

export interface AppNotification {
  id: ID;
  userId: ID;
  title: string;
  body: string;
  kind: 'SESSION' | 'EXAM' | 'ASSIGNMENT' | 'MISSED' | 'ANNOUNCEMENT';
  readAt: Timestamp | null;
  createdAt: Timestamp;
}

export type FeedbackCategory = 'BUG' | 'FEATURE_REQUEST' | 'GENERAL_FEEDBACK';
export type FeedbackStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

export interface Feedback {
  id: ID;
  userId: ID | null;
  userEmail: string | null;
  category: FeedbackCategory;
  message: string;
  status: FeedbackStatus;
  createdAt: Timestamp;
}

/* -------------------------------------------------------------------------- */
/* Admin                                                                      */
/* -------------------------------------------------------------------------- */

export type AnnouncementStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface Announcement {
  id: ID;
  title: string;
  body: string;
  status: AnnouncementStatus;
  createdAt: Timestamp;
  publishedAt: Timestamp | null;
}

export interface FeatureFlags {
  gpaCalculatorEnabled: boolean;
  gpaProjectionEnabled: boolean;
  plannerEnabled: boolean;
  goalsEnabled: boolean;
  streaksEnabled: boolean;
  sharingEnabled: boolean;
  notificationsEnabled: boolean;
}

export interface AdminActivityLog {
  id: ID;
  adminEmail: string;
  action: string;
  resource: string;
  createdAt: Timestamp;
}

/** Product usage counters — deliberately non-sensitive. */
export interface UsageEvent {
  id: ID;
  userId: ID | null;
  name:
    | 'gpa_calculated'
    | 'registered'
    | 'onboarding_completed'
    | 'course_created'
    | 'result_recorded'
    | 'plan_generated'
    | 'session_completed'
    | 'session_skipped'
    | 'snapshot_created'
    | 'app_opened';
  createdAt: Timestamp;
}

export interface Preferences {
  theme: 'light' | 'dark' | 'system';
  notificationsEnabled: boolean;
  reminderLeadMinutes: number;
  defaultSessionMinutes: number;
}
