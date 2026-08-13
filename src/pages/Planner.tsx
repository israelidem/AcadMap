/**
 * Planner — sessions, availability, events and tasks.
 *
 * The generator lives in shared/scheduler.ts; this page only collects inputs and
 * renders the outcome, including the notes explaining what could not be placed.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Check, Copy, Plus, SkipForward, Sparkles, Trash2 } from 'lucide-react';
import { DEFAULT_PLANNER_CONFIG } from '@shared/scheduler';
import { formatDuration, todayStr, WEEKDAY_LABELS } from '@shared/time';
import type { EventType, Priority, Weekday } from '@shared/types';
import {
  addAvailability,
  copyAvailabilityToAllDays,
  createEvent,
  createTask,
  deleteAvailability,
  deleteEvent,
  deleteSession,
  deleteTask,
  generatePlan,
  completeSession,
  rescheduleSession,
  skipSession,
  toggleTask,
} from '@/lib/actions';
import { useSession, useUserData } from '@/lib/hooks';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Select,
  Stat,
  Toggle,
  useToast,
} from '@/components/ui';
import { Tabs } from '@/components/tabs';

const WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

export default function Planner() {
  const { user, preferences } = useSession();
  const toast = useToast();
  const { sessions, availability, events, tasks, courses, topics } = useUserData(user?.id ?? null);

  const [tab, setTab] = useState('sessions');
  const [notes, setNotes] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);

  const [horizonDays, setHorizonDays] = useState(String(DEFAULT_PLANNER_CONFIG.horizonDays));
  const [sessionMinutes, setSessionMinutes] = useState(String(preferences.defaultSessionMinutes));
  const [maxMinutesPerDay, setMaxMinutesPerDay] = useState(
    String(DEFAULT_PLANNER_CONFIG.maxMinutesPerDay),
  );
  const [replaceExisting, setReplaceExisting] = useState(true);

  const [slotDay, setSlotDay] = useState<Weekday>(1);
  const [slotStart, setSlotStart] = useState('17:00');
  const [slotEnd, setSlotEnd] = useState('20:00');

  const [eventOpen, setEventOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [rescheduling, setRescheduling] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState(todayStr());
  const [rescheduleStart, setRescheduleStart] = useState('17:00');
  const [rescheduleEnd, setRescheduleEnd] = useState('18:00');

  if (!user) return null;

  const today = todayStr();
  const activeCourses = courses.filter((course) => !course.archived);
  const courseName = (courseId: string | null) =>
    courses.find((course) => course.id === courseId)?.name ?? 'Course';
  const topicTitle = (topicId: string | null) =>
    topicId ? (topics.find((topic) => topic.id === topicId)?.title ?? null) : null;

  const upcomingSessions = sessions.filter(
    (session) => session.date >= today && session.status !== 'RESCHEDULED',
  );
  const completedCount = sessions.filter((session) => session.status === 'COMPLETED').length;
  const scheduledCount = sessions.filter((session) => session.status === 'SCHEDULED').length;

  const generate = () => {
    if (activeCourses.length === 0) {
      toast('Add a course first.', 'error');
      return;
    }
    if (availability.length === 0) {
      toast('Set when you are available to study first.', 'error');
      setTab('availability');
      return;
    }

    setGenerating(true);
    const result = generatePlan(user.id, {
      ...DEFAULT_PLANNER_CONFIG,
      horizonDays: Math.min(60, Math.max(1, Number(horizonDays) || 14)),
      sessionMinutes: Math.min(180, Math.max(30, Number(sessionMinutes) || 60)),
      maxMinutesPerDay: Math.min(720, Math.max(30, Number(maxMinutesPerDay) || 240)),
      replaceExisting,
    });
    setGenerating(false);
    setNotes(result.notes);
    toast(`${result.sessions.length} session(s) scheduled.`);
  };

  return (
    <>
      <PageHeader
        title="Planner"
        description="Exams, deadlines and availability in, a workable study schedule out."
        action={
          <Button
            size="sm"
            icon={<Sparkles className="h-4 w-4" />}
            loading={generating}
            onClick={generate}
          >
            Generate study plan
          </Button>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Scheduled sessions" value={scheduledCount} />
        <Stat label="Completed sessions" value={completedCount} tone="success" />
        <Stat
          label="Planned vs completed"
          value={`${completedCount}/${completedCount + scheduledCount}`}
        />
      </div>

      {notes.length > 0 && (
        <Card className="mb-4" title="Planner notes">
          <ul className="grid gap-1.5 text-sm text-muted">
            {notes.map((note) => (
              <li key={note}>• {note}</li>
            ))}
          </ul>
        </Card>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'sessions', label: 'Study sessions' },
          { value: 'availability', label: 'Availability' },
          { value: 'deadlines', label: 'Events & tasks' },
          { value: 'settings', label: 'Plan settings' },
        ]}
      />

      {tab === 'sessions' && (
        <Card title="Upcoming sessions" description="Complete, skip or reschedule as your week changes.">
          {upcomingSessions.length === 0 ? (
            <EmptyState
              icon={<CalendarClock className="h-6 w-6" />}
              title="No sessions scheduled"
              description="Add topics to your courses, set your availability, then generate a plan."
              action={
                <Link to="/app/courses">
                  <Button variant="secondary">Go to courses</Button>
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {upcomingSessions.map((session) => (
                <li key={session.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {courseName(session.courseId)}
                      {topicTitle(session.topicId) && (
                        <span className="text-muted"> · {topicTitle(session.topicId)}</span>
                      )}
                    </p>
                    <p className="text-sm text-muted">
                      {session.date} · {session.startTime}–{session.endTime} ·{' '}
                      {formatDuration(session.durationMinutes)}
                      {session.generated ? ' · auto' : ''}
                    </p>
                  </div>
                  {session.status === 'SCHEDULED' ? (
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        size="sm"
                        icon={<Check className="h-4 w-4" />}
                        onClick={() => {
                          completeSession(user.id, session.id);
                          toast('Session completed.');
                        }}
                      >
                        Complete
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<SkipForward className="h-4 w-4" />}
                        onClick={() => skipSession(user.id, session.id)}
                      >
                        Skip
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setRescheduling(session.id);
                          setRescheduleDate(session.date);
                          setRescheduleStart(session.startTime);
                          setRescheduleEnd(session.endTime);
                        }}
                      >
                        Reschedule
                      </Button>
                      <button
                        type="button"
                        aria-label="Delete session"
                        className="am-touch grid place-items-center rounded-xl text-danger hover:bg-surface-2"
                        onClick={() => deleteSession(user.id, session.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <Badge tone={session.status === 'COMPLETED' ? 'success' : 'warning'}>
                      {session.status}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'availability' && (
        <Card
          title="When can you study?"
          description="Multiple periods per day are supported; days without a period are treated as unavailable."
        >
          <div className="flex flex-wrap items-end gap-2">
            <Select
              label="Day"
              className="w-36"
              value={String(slotDay)}
              onChange={(event) => setSlotDay(Number(event.target.value) as Weekday)}
            >
              {WEEKDAYS.map((day) => (
                <option key={day} value={day}>
                  {WEEKDAY_LABELS[day]}
                </option>
              ))}
            </Select>
            <Input
              label="From"
              type="time"
              className="w-32"
              value={slotStart}
              onChange={(event) => setSlotStart(event.target.value)}
            />
            <Input
              label="To"
              type="time"
              className="w-32"
              value={slotEnd}
              onChange={(event) => setSlotEnd(event.target.value)}
            />
            <Button
              icon={<Plus className="h-4 w-4" />}
              onClick={() => {
                const slot = addAvailability(user.id, slotDay, slotStart, slotEnd);
                if (!slot) toast('The end time must be after the start time.', 'error');
              }}
            >
              Add period
            </Button>
            <Button
              variant="secondary"
              icon={<Copy className="h-4 w-4" />}
              onClick={() => {
                copyAvailabilityToAllDays(user.id, slotDay);
                toast(`${WEEKDAY_LABELS[slotDay]} copied to every day.`);
              }}
            >
              Copy to all days
            </Button>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {WEEKDAYS.map((day) => {
              const slots = availability.filter((slot) => slot.weekday === day);
              return (
                <div key={day} className="rounded-xl border border-border px-3 py-3">
                  <p className="text-sm font-medium">{WEEKDAY_LABELS[day]}</p>
                  {slots.length === 0 ? (
                    <p className="mt-1 text-sm text-muted">Unavailable</p>
                  ) : (
                    <ul className="mt-1 grid gap-1">
                      {slots.map((slot) => (
                        <li key={slot.id} className="flex items-center gap-2 text-sm">
                          <span className="tabular flex-1">
                            {slot.startTime}–{slot.endTime}
                          </span>
                          <button
                            type="button"
                            aria-label="Remove period"
                            className="text-danger"
                            onClick={() => deleteAvailability(user.id, slot.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {tab === 'deadlines' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card
            title="Events"
            description="Exams and tests pull study sessions earlier."
            action={
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEventOpen(true)}>
                Add event
              </Button>
            }
          >
            {events.length === 0 ? (
              <p className="text-sm text-muted">No events yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {events.map((event) => (
                  <li key={event.id} className="flex items-center gap-2 py-2 text-sm">
                    <Badge
                      tone={
                        event.type === 'EXAM' ? 'danger' : event.type === 'TEST' ? 'warning' : 'neutral'
                      }
                    >
                      {event.type}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate">
                      {event.title}
                      {event.courseId && (
                        <span className="text-muted"> · {courseName(event.courseId)}</span>
                      )}
                    </span>
                    <span className="tabular text-muted">{event.date}</span>
                    <button
                      type="button"
                      aria-label="Delete event"
                      className="text-danger"
                      onClick={() => deleteEvent(user.id, event.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Tasks"
            description="Smaller pieces of work with a due date."
            action={
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setTaskOpen(true)}>
                Add task
              </Button>
            }
          >
            {tasks.length === 0 ? (
              <p className="text-sm text-muted">No tasks yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {tasks.map((task) => (
                  <li key={task.id} className="flex items-center gap-2 py-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[rgb(var(--am-brand))]"
                      checked={task.status === 'DONE'}
                      onChange={() => toggleTask(user.id, task.id)}
                      aria-label={`Mark ${task.title} done`}
                    />
                    <span
                      className={`min-w-0 flex-1 truncate ${task.status === 'DONE' ? 'text-muted line-through' : ''}`}
                    >
                      {task.title}
                    </span>
                    <Badge tone={task.priority === 'HIGH' ? 'danger' : 'neutral'}>{task.priority}</Badge>
                    <span className="tabular text-muted">{task.dueDate ?? '—'}</span>
                    <button
                      type="button"
                      aria-label="Delete task"
                      className="text-danger"
                      onClick={() => deleteTask(user.id, task.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === 'settings' && (
        <Card title="Plan settings" description="Applied the next time you generate a plan.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="Days ahead"
              type="number"
              min={1}
              max={60}
              value={horizonDays}
              onChange={(event) => setHorizonDays(event.target.value)}
            />
            <Input
              label="Session length (minutes)"
              type="number"
              min={30}
              max={180}
              step={15}
              value={sessionMinutes}
              onChange={(event) => setSessionMinutes(event.target.value)}
            />
            <Input
              label="Daily study cap (minutes)"
              type="number"
              min={30}
              max={720}
              step={30}
              value={maxMinutesPerDay}
              onChange={(event) => setMaxMinutesPerDay(event.target.value)}
            />
          </div>
          <div className="mt-4">
            <Toggle
              checked={replaceExisting}
              onChange={setReplaceExisting}
              label="Replace future auto-generated sessions"
            />
            <p className="mt-1 text-sm text-muted">
              Completed and manually created sessions are never removed.
            </p>
          </div>
        </Card>
      )}

      <EventModal
        open={eventOpen}
        onClose={() => setEventOpen(false)}
        onSave={(fields) => {
          createEvent(user.id, fields);
          toast('Event added.');
        }}
        courses={activeCourses.map((course) => ({ id: course.id, name: course.name }))}
      />

      <TaskModal
        open={taskOpen}
        onClose={() => setTaskOpen(false)}
        onSave={(fields) => {
          createTask(user.id, fields);
          toast('Task added.');
        }}
        courses={activeCourses.map((course) => ({ id: course.id, name: course.name }))}
      />

      <Modal
        open={rescheduling !== null}
        onClose={() => setRescheduling(null)}
        title="Reschedule session"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRescheduling(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!rescheduling) return;
                rescheduleSession(
                  user.id,
                  rescheduling,
                  rescheduleDate,
                  rescheduleStart,
                  rescheduleEnd,
                );
                setRescheduling(null);
                toast('Session rescheduled.');
              }}
            >
              Reschedule
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            label="Date"
            type="date"
            value={rescheduleDate}
            onChange={(event) => setRescheduleDate(event.target.value)}
          />
          <Input
            label="From"
            type="time"
            value={rescheduleStart}
            onChange={(event) => setRescheduleStart(event.target.value)}
          />
          <Input
            label="To"
            type="time"
            value={rescheduleEnd}
            onChange={(event) => setRescheduleEnd(event.target.value)}
          />
        </div>
      </Modal>
    </>
  );
}

interface CourseOption {
  id: string;
  name: string;
}

function EventModal({
  open,
  onClose,
  onSave,
  courses,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (fields: {
    courseId: string | null;
    type: EventType;
    title: string;
    date: string;
    startTime: string | null;
    endTime: string | null;
    notes: string | null;
  }) => void;
  courses: CourseOption[];
}) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [type, setType] = useState<EventType>('EXAM');
  const [courseId, setCourseId] = useState('');
  const [date, setDate] = useState(todayStr());

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add event"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (title.trim().length < 2) {
                toast('Give the event a title.', 'error');
                return;
              }
              onSave({
                courseId: courseId || null,
                type,
                title: title.trim(),
                date,
                startTime: null,
                endTime: null,
                notes: null,
              });
              setTitle('');
              onClose();
            }}
          >
            Add event
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Input label="Title" value={title} onChange={(event) => setTitle(event.target.value)} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Select label="Type" value={type} onChange={(event) => setType(event.target.value as EventType)}>
            <option value="EXAM">Exam</option>
            <option value="TEST">Test</option>
            <option value="ASSIGNMENT">Assignment</option>
            <option value="OTHER">Other</option>
          </Select>
          <Select label="Course" value={courseId} onChange={(event) => setCourseId(event.target.value)}>
            <option value="">No course</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </Select>
          <Input label="Date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

function TaskModal({
  open,
  onClose,
  onSave,
  courses,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (fields: {
    courseId: string | null;
    title: string;
    dueDate: string | null;
    priority: Priority;
  }) => void;
  courses: CourseOption[];
}) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [courseId, setCourseId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<Priority>('MEDIUM');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add task"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (title.trim().length < 2) {
                toast('Give the task a title.', 'error');
                return;
              }
              onSave({
                courseId: courseId || null,
                title: title.trim(),
                dueDate: dueDate || null,
                priority,
              });
              setTitle('');
              setDueDate('');
              onClose();
            }}
          >
            Add task
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Input label="Title" value={title} onChange={(event) => setTitle(event.target.value)} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Select label="Course" value={courseId} onChange={(event) => setCourseId(event.target.value)}>
            <option value="">No course</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </Select>
          <Input
            label="Due date"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
          <Select
            label="Priority"
            value={priority}
            onChange={(event) => setPriority(event.target.value as Priority)}
          >
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </Select>
        </div>
      </div>
    </Modal>
  );
}
