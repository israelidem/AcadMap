/**
 * Course topics.
 *
 * Suggestions are advisory only — a student can accept, rename, reorder, add or
 * remove any topic, and nothing is added without an explicit action.
 */

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Check, ListPlus, Plus, Trash2, Wand2 } from 'lucide-react';
import { suggestTopics } from '@shared/topicSuggestions';
import { formatDuration } from '@shared/time';
import type { Difficulty } from '@shared/types';
import { addTopics, deleteTopic, moveTopic, updateTopic } from '@/lib/actions';
import { useSession, useUserData } from '@/lib/hooks';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Progress,
  Select,
  useToast,
} from '@/components/ui';

const DIFFICULTIES: Difficulty[] = ['EASY', 'NORMAL', 'HARD'];

export default function CourseDetail() {
  const { courseId = '' } = useParams();
  const { user } = useSession();
  const toast = useToast();
  const { courses, topics, terms, years, sessions } = useUserData(user?.id ?? null);

  const course = courses.find((item) => item.id === courseId) ?? null;
  const courseTopics = topics.filter((topic) => topic.courseId === courseId);

  const [newTitle, setNewTitle] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const suggestions = useMemo(() => {
    if (!course) return [];
    const existing = new Set(courseTopics.map((topic) => topic.title.toLowerCase()));
    return suggestTopics(course.name).filter((title) => !existing.has(title.toLowerCase()));
  }, [course, courseTopics]);

  if (!user) return null;

  if (!course) {
    return (
      <EmptyState
        title="Course not found"
        description="It may have been deleted."
        action={
          <Link to="/app/courses">
            <Button>Back to courses</Button>
          </Link>
        }
      />
    );
  }

  const term = terms.find((item) => item.id === course.termId);
  const year = years.find((item) => item.id === term?.academicYearId);

  const plannedMinutes = courseTopics.reduce((total, topic) => total + topic.estimatedMinutes, 0);
  const completedMinutes = courseTopics.reduce((total, topic) => total + topic.completedMinutes, 0);
  const courseSessions = sessions.filter((session) => session.courseId === course.id);

  const addTopic = () => {
    const title = newTitle.trim();
    if (title.length < 2) {
      toast('Give the topic a name first.', 'error');
      return;
    }
    addTopics(user.id, course.id, [title]);
    setNewTitle('');
  };

  const acceptSuggestions = () => {
    if (selected.length === 0) return;
    addTopics(user.id, course.id, selected);
    setSelected([]);
    toast(`${selected.length} topic(s) added.`);
  };

  return (
    <>
      <PageHeader
        title={course.name}
        description={[course.code, year && term ? `${year.label} · ${term.label}` : term?.label, `${course.units} units`]
          .filter(Boolean)
          .join(' · ')}
        action={
          <Link to="/app/courses">
            <Button variant="secondary" size="sm">
              All courses
            </Button>
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Topics" description="Reorder to tell the planner what matters first.">
          <div className="mb-4 flex flex-wrap items-end gap-2">
            <Input
              label="New topic"
              className="min-w-[12rem] flex-1"
              placeholder="e.g. Fundamental Rights"
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addTopic();
              }}
            />
            <Button icon={<Plus className="h-4 w-4" />} onClick={addTopic}>
              Add
            </Button>
          </div>

          {courseTopics.length === 0 ? (
            <EmptyState
              icon={<ListPlus className="h-6 w-6" />}
              title="No topics yet"
              description="Topics are the units of work the study planner schedules."
            />
          ) : (
            <ul className="grid gap-2">
              {courseTopics.map((topic, index) => (
                <li key={topic.id} className="rounded-xl border border-border px-3 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      className="am-input h-9 min-w-[10rem] flex-1"
                      aria-label="Topic title"
                      value={topic.title}
                      onChange={(event) =>
                        updateTopic(user.id, topic.id, { title: event.target.value })
                      }
                    />
                    <Select
                      aria-label="Difficulty"
                      className="h-9 w-28"
                      value={topic.difficulty}
                      onChange={(event) =>
                        updateTopic(user.id, topic.id, {
                          difficulty: event.target.value as Difficulty,
                        })
                      }
                    >
                      {DIFFICULTIES.map((difficulty) => (
                        <option key={difficulty} value={difficulty}>
                          {difficulty}
                        </option>
                      ))}
                    </Select>
                    <Input
                      aria-label="Estimated minutes"
                      className="h-9 w-24"
                      type="number"
                      min={15}
                      max={2400}
                      step={15}
                      value={topic.estimatedMinutes}
                      onChange={(event) =>
                        updateTopic(user.id, topic.id, {
                          estimatedMinutes: Number(event.target.value) || 0,
                        })
                      }
                    />
                    <Button
                      size="sm"
                      variant={topic.done ? 'primary' : 'secondary'}
                      icon={<Check className="h-4 w-4" />}
                      onClick={() => updateTopic(user.id, topic.id, { done: !topic.done })}
                    >
                      {topic.done ? 'Done' : 'Mark done'}
                    </Button>
                    <div className="flex">
                      <button
                        type="button"
                        aria-label="Move topic up"
                        disabled={index === 0}
                        className="am-touch grid place-items-center rounded-xl text-muted hover:bg-surface-2 disabled:opacity-40"
                        onClick={() => moveTopic(user.id, topic.id, -1)}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Move topic down"
                        disabled={index === courseTopics.length - 1}
                        className="am-touch grid place-items-center rounded-xl text-muted hover:bg-surface-2 disabled:opacity-40"
                        onClick={() => moveTopic(user.id, topic.id, 1)}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Delete topic"
                        className="am-touch grid place-items-center rounded-xl text-danger hover:bg-surface-2"
                        onClick={() => deleteTopic(user.id, topic.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {topic.estimatedMinutes > 0 && (
                    <div className="mt-2">
                      <Progress
                        value={(topic.completedMinutes / topic.estimatedMinutes) * 100}
                        label={`${formatDuration(topic.completedMinutes)} of ${formatDuration(topic.estimatedMinutes)} studied`}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="grid gap-4">
          <Card title="Workload">
            <Progress
              value={plannedMinutes === 0 ? 0 : (completedMinutes / plannedMinutes) * 100}
              label={`${formatDuration(completedMinutes)} of ${formatDuration(plannedMinutes)} planned`}
            />
            <p className="mt-3 text-sm text-muted">
              {courseSessions.filter((session) => session.status === 'COMPLETED').length} completed
              session(s), {courseSessions.filter((session) => session.status === 'SCHEDULED').length}{' '}
              scheduled.
            </p>
          </Card>

          <Card
            title="Suggested topics"
            description="Advisory only — pick what fits your syllabus."
          >
            {suggestions.length === 0 ? (
              <p className="text-sm text-muted">No suggestions for this course name.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((title) => {
                    const active = selected.includes(title);
                    return (
                      <button
                        key={title}
                        type="button"
                        onClick={() =>
                          setSelected((current) =>
                            active ? current.filter((item) => item !== title) : [...current, title],
                          )
                        }
                        className="rounded-full border border-border px-3 py-1 text-sm hover:bg-surface-2"
                        aria-pressed={active}
                      >
                        {active ? <Badge tone="brand">{title}</Badge> : title}
                      </button>
                    );
                  })}
                </div>
                <Button
                  className="mt-3"
                  size="sm"
                  icon={<Wand2 className="h-4 w-4" />}
                  onClick={acceptSuggestions}
                  disabled={selected.length === 0}
                >
                  Add {selected.length || ''} selected
                </Button>
              </>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
