/**
 * Turns the browser's local AcadMap data into the payload `POST /api/import`
 * expects, so a student who used AcadMap before creating an account keeps
 * everything they built.
 *
 * Cross-references (a course's term, a topic's course) are sent as the local ids
 * they already use; the server rewrites them to real UUIDs. Study sessions are
 * deliberately left out: they are derived from courses, topics, deadlines and
 * availability, so the planner can regenerate them server-side rather than
 * importing a schedule that may already be stale.
 */

import type { ID } from '@shared/types';
import type { ImportBundle } from '@shared/schemas';
import { PRESET_GRADING_SYSTEMS } from '@shared/grading';
import { getDatabase } from './store';

/** Whether there is anything worth sending for this local account. */
export function hasLocalDataToImport(userId: ID): boolean {
  const db = getDatabase();
  return (
    db.academicYears.some((year) => year.userId === userId) ||
    db.courses.some((course) => course.userId === userId) ||
    db.results.some((result) => result.userId === userId) ||
    db.events.some((event) => event.userId === userId) ||
    db.tasks.some((task) => task.userId === userId) ||
    db.availability.some((slot) => slot.userId === userId) ||
    db.goals.some((goal) => goal.userId === userId)
  );
}

export function buildImportBundle(userId: ID): ImportBundle {
  const db = getDatabase();
  const profile = db.profiles.find((row) => row.userId === userId);

  // The grading system travels with the student even when it is one of our
  // presets: the account needs its own copy for results to have grade points.
  const source =
    db.gradingSystems.find((system) => system.id === profile?.gradingSystemId) ??
    PRESET_GRADING_SYSTEMS.find((system) => system.id === profile?.gradingSystemId);

  const years = db.academicYears.filter((year) => year.userId === userId);
  const yearIds = new Set(years.map((year) => year.id));
  const terms = db.terms.filter(
    (term) => term.userId === userId && yearIds.has(term.academicYearId),
  );
  const termIds = new Set(terms.map((term) => term.id));
  const courses = db.courses.filter(
    (course) => course.userId === userId && termIds.has(course.termId),
  );
  const courseIds = new Set(courses.map((course) => course.id));

  return {
    profile: profile
      ? {
          fullName: profile.fullName,
          institution: profile.institution,
          faculty: profile.faculty,
          department: profile.department,
          programme: profile.programme,
          level: profile.level,
          expectedGraduationYear: profile.expectedGraduationYear,
          avatarDataUrl: profile.avatarDataUrl,
          termStructure: profile.termStructure,
        }
      : undefined,

    gradingSystem: source
      ? {
          name: source.name,
          scale: source.scale,
          rules: source.rules.map((rule) => ({
            name: rule.name,
            point: rule.point,
            minScore: rule.minScore,
          })),
        }
      : undefined,

    academicYears: years.map((year) => ({
      localId: year.id,
      label: year.label,
      startYear: year.startYear,
      isCurrent: year.isCurrent,
    })),

    terms: terms.map((term) => ({
      localId: term.id,
      academicYearId: term.academicYearId,
      label: term.label,
      position: term.position,
      startDate: term.startDate,
      endDate: term.endDate,
      isCurrent: term.isCurrent,
    })),

    courses: courses.map((course) => ({
      localId: course.id,
      termId: course.termId,
      name: course.name,
      code: course.code,
      units: course.units,
      priority: course.priority,
      examDate: course.examDate,
      description: course.description,
    })),

    topics: db.topics
      .filter((topic) => topic.userId === userId && courseIds.has(topic.courseId))
      .map((topic) => ({
        localId: topic.id,
        courseId: topic.courseId,
        title: topic.title,
        difficulty: topic.difficulty,
        estimatedMinutes: topic.estimatedMinutes,
      })),

    results: db.results
      .filter((result) => result.userId === userId && termIds.has(result.termId))
      .map((result) => ({
        termId: result.termId,
        courseId: courseIds.has(result.courseId ?? '') ? result.courseId : null,
        courseName: result.courseName,
        courseCode: result.courseCode,
        units: result.units,
        gradeName: result.gradeName,
        countsInGpa: result.countsInGpa,
        isRepeat: result.isRepeat,
        // Result-to-result links are local ids the server cannot resolve yet, so
        // the repeat flag travels but the link does not.
        replacesResultId: null,
      })),

    events: db.events
      .filter((event) => event.userId === userId)
      .map((event) => ({
        courseId: courseIds.has(event.courseId ?? '') ? event.courseId : null,
        type: event.type,
        title: event.title,
        date: event.date,
        startTime: event.startTime,
        endTime: event.endTime,
        notes: event.notes,
      })),

    tasks: db.tasks
      .filter((task) => task.userId === userId)
      .map((task) => ({
        courseId: courseIds.has(task.courseId ?? '') ? task.courseId : null,
        title: task.title,
        dueDate: task.dueDate,
        priority: task.priority,
      })),

    availability: db.availability
      .filter((slot) => slot.userId === userId)
      .map((slot) => ({
        weekday: slot.weekday,
        startTime: slot.startTime,
        endTime: slot.endTime,
      })),

    goals: db.goals
      .filter((goal) => goal.userId === userId)
      .map((goal) => ({
        type: goal.type,
        title: goal.title,
        targetValue: goal.targetValue,
        termId: termIds.has(goal.termId ?? '') ? goal.termId : null,
        dueDate: goal.dueDate,
      })),
  };
}
