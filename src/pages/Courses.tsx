/** Course management: create, edit, archive, delete; grouped by term. */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, BookOpen, Pencil, Plus } from 'lucide-react';
import { courseSchema } from '@shared/schemas';
import type { Course, Priority } from '@shared/types';
import { createCourse, deleteCourse, setCourseArchived, updateCourse } from '@/lib/actions';
import { useSession, useUserData } from '@/lib/hooks';
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Select,
  Textarea,
  useToast,
} from '@/components/ui';

const PRIORITY_TONE: Record<Priority, 'danger' | 'warning' | 'neutral'> = {
  HIGH: 'danger',
  MEDIUM: 'warning',
  LOW: 'neutral',
};

interface FormState {
  termId: string;
  name: string;
  code: string;
  units: string;
  priority: Priority;
  examDate: string;
  description: string;
}

function blankForm(termId: string): FormState {
  return {
    termId,
    name: '',
    code: '',
    units: '3',
    priority: 'MEDIUM',
    examDate: '',
    description: '',
  };
}

export default function Courses() {
  const { user } = useSession();
  const toast = useToast();
  const { courses, terms, years, topics } = useUserData(user?.id ?? null);

  const defaultTermId = terms.find((term) => term.isCurrent)?.id ?? terms[0]?.id ?? '';
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Course | null>(null);
  const [form, setForm] = useState<FormState>(() => blankForm(defaultTermId));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showArchived, setShowArchived] = useState(false);

  const termLabel = (termId: string) => {
    const term = terms.find((item) => item.id === termId);
    if (!term) return 'Unassigned';
    const year = years.find((item) => item.id === term.academicYearId);
    return year ? `${year.label} · ${term.label}` : term.label;
  };

  const grouped = useMemo(() => {
    const visible = courses.filter((course) => course.archived === showArchived);
    const map = new Map<string, Course[]>();
    for (const course of visible) {
      map.set(course.termId, [...(map.get(course.termId) ?? []), course]);
    }
    return [...map.entries()].sort((a, b) => termLabel(a[0]).localeCompare(termLabel(b[0])));
  }, [courses, showArchived, terms, years]);

  if (!user) return null;

  const openCreate = () => {
    setEditing(null);
    setForm(blankForm(defaultTermId));
    setErrors({});
    setOpen(true);
  };

  const openEdit = (course: Course) => {
    setEditing(course);
    setForm({
      termId: course.termId,
      name: course.name,
      code: course.code,
      units: String(course.units),
      priority: course.priority,
      examDate: course.examDate ?? '',
      description: course.description ?? '',
    });
    setErrors({});
    setOpen(true);
  };

  const save = () => {
    const parsed = courseSchema.safeParse({
      termId: form.termId,
      name: form.name,
      code: form.code,
      units: Number(form.units),
      priority: form.priority,
      examDate: form.examDate || null,
      description: form.description || null,
    });

    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }

    if (editing) {
      updateCourse(user.id, editing.id, parsed.data);
      toast('Course updated.');
    } else {
      createCourse(user.id, parsed.data);
      toast('Course added.');
    }
    setOpen(false);
  };

  if (terms.length === 0) {
    return (
      <>
        <PageHeader title="Courses" />
        <EmptyState
          icon={<BookOpen className="h-6 w-6" />}
          title="Create a term first"
          description="Courses belong to a term, so add an academic year and term in your academic record."
          action={
            <Link to="/app/record">
              <Button>Open academic record</Button>
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Courses"
        description="Units, priority and exam dates feed both your GPA and your study plan."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setShowArchived((value) => !value)}>
              {showArchived ? 'Show active' : 'Show archived'}
            </Button>
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
              Add course
            </Button>
          </div>
        }
      />

      {grouped.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-6 w-6" />}
          title={showArchived ? 'No archived courses' : 'No courses yet'}
          description={
            showArchived
              ? 'Archived courses stay out of your planner but keep their results.'
              : 'Add your courses to start tracking results and generating study sessions.'
          }
          action={!showArchived ? <Button onClick={openCreate}>Add your first course</Button> : undefined}
        />
      ) : (
        <div className="grid gap-4">
          {grouped.map(([termId, list]) => (
            <Card key={termId} title={termLabel(termId)} description={`${list.length} course(s)`}>
              <ul className="divide-y divide-border">
                {list.map((course) => {
                  const courseTopics = topics.filter((topic) => topic.courseId === course.id);
                  const doneTopics = courseTopics.filter((topic) => topic.done).length;
                  return (
                    <li key={course.id} className="flex flex-wrap items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to={`/app/courses/${course.id}`}
                            className="font-medium hover:text-brand"
                          >
                            {course.name}
                          </Link>
                          {course.code && <Badge>{course.code}</Badge>}
                          <Badge tone={PRIORITY_TONE[course.priority]}>{course.priority}</Badge>
                        </div>
                        <p className="mt-0.5 text-sm text-muted">
                          {course.units} unit{course.units === 1 ? '' : 's'}
                          {courseTopics.length > 0 &&
                            ` · ${doneTopics}/${courseTopics.length} topics done`}
                          {course.examDate && ` · exam ${course.examDate}`}
                        </p>
                      </div>
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Pencil className="h-4 w-4" />}
                          onClick={() => openEdit(course)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Archive className="h-4 w-4" />}
                          onClick={() => {
                            setCourseArchived(user.id, course.id, !course.archived);
                            toast(course.archived ? 'Course restored.' : 'Course archived.');
                          }}
                        >
                          {course.archived ? 'Restore' : 'Archive'}
                        </Button>
                        <ConfirmButton
                          title="Delete course?"
                          body="This removes the course, its topics and its study sessions. Recorded results are kept."
                          confirmLabel="Delete course"
                          onConfirm={() => {
                            deleteCourse(user.id, course.id);
                            toast('Course deleted.');
                          }}
                        >
                          Delete
                        </ConfirmButton>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit course' : 'Add course'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save}>{editing ? 'Save changes' : 'Add course'}</Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Select
            label="Term"
            value={form.termId}
            onChange={(event) => setForm({ ...form, termId: event.target.value })}
            error={errors.termId}
          >
            {terms.map((term) => (
              <option key={term.id} value={term.id}>
                {termLabel(term.id)}
              </option>
            ))}
          </Select>
          <Input
            label="Course name"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            error={errors.name}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Course code"
              placeholder="e.g. LAW 301"
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
              error={errors.code}
            />
            <Input
              label="Credit units"
              type="number"
              min={0}
              max={30}
              step="0.5"
              value={form.units}
              onChange={(event) => setForm({ ...form, units: event.target.value })}
              error={errors.units}
            />
            <Select
              label="Priority"
              value={form.priority}
              onChange={(event) => setForm({ ...form, priority: event.target.value as Priority })}
            >
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </Select>
            <Input
              label="Exam date (optional)"
              type="date"
              value={form.examDate}
              onChange={(event) => setForm({ ...form, examDate: event.target.value })}
              error={errors.examDate}
            />
          </div>
          <Textarea
            label="Description (optional)"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </div>
      </Modal>
    </>
  );
}
