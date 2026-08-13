/**
 * Dashboard — today first, then trajectory.
 *
 * Order follows the PRD: greeting, GPA/CGPA, today's sessions, upcoming
 * deadlines, streak, progress, performance chart.
 */

import { Link } from 'react-router-dom';
import { CalendarClock, Check, SkipForward, TrendingDown, TrendingUp } from 'lucide-react';
import { formatDuration, todayStr } from '@shared/time';
import { round } from '@shared/gpa';
import { completeSession, skipSession } from '@/lib/actions';
import { useAcademicMetrics, usePlannerMetrics, useSession, useUserData } from '@/lib/hooks';
import { GpaHistoryChart } from '@/components/charts';
import { Badge, Button, Card, EmptyState, PageHeader, Progress, Stat, useToast } from '@/components/ui';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard() {
  const { user, profile } = useSession();
  const toast = useToast();
  const metrics = useAcademicMetrics();
  const planner = usePlannerMetrics();
  const { courses, topics, events, tasks, terms, announcements } = useUserData(user?.id ?? null);

  if (!user) return null;

  const today = todayStr();
  const firstName = (profile?.fullName ?? '').split(' ')[0] || 'there';
  const currentTerm = terms.find((term) => term.isCurrent);

  const courseName = (courseId: string) =>
    courses.find((course) => course.id === courseId)?.name ?? 'Course';
  const topicTitle = (topicId: string | null) =>
    topicId ? (topics.find((topic) => topic.id === topicId)?.title ?? null) : null;

  const upcomingEvents = events
    .filter((event) => event.date >= today)
    .slice(0, 5);
  const openTasks = tasks.filter((task) => task.status === 'TODO').slice(0, 5);

  const termTopics = topics.filter((topic) =>
    courses.some((course) => course.id === topic.courseId && course.termId === currentTerm?.id),
  );
  const topicProgress =
    termTopics.length === 0
      ? 0
      : (termTopics.filter((topic) => topic.done).length / termTopics.length) * 100;

  const TrendIcon = metrics.trend === 'DOWN' ? TrendingDown : TrendingUp;

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName}.`}
        description={
          currentTerm
            ? `${currentTerm.label}${profile?.level ? ` · ${profile.level}` : ''}`
            : 'Add an academic year and term to start tracking.'
        }
      />

      {announcements.length > 0 && (
        <div className="mb-4 grid gap-2">
          {announcements.slice(0, 2).map((announcement) => (
            <div
              key={announcement.id}
              className="rounded-xl border border-brand/30 bg-brand-soft px-4 py-3 text-sm"
            >
              <p className="font-medium">{announcement.title}</p>
              <p className="text-muted">{announcement.body}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="CGPA"
          tone="brand"
          value={metrics.cgpa.toFixed(2)}
          sub={`of ${round(metrics.scale, 2)}`}
        />
        <Stat
          label="Current term GPA"
          value={metrics.termGpa.toFixed(2)}
          sub={`${metrics.termUnits} unit(s) recorded`}
        />
        <Stat label="Completed units" value={metrics.completedUnits} />
        <Stat
          label="Study streak"
          value={`🔥 ${planner.streak.current} day${planner.streak.current === 1 ? '' : 's'}`}
          sub={`longest ${planner.streak.longest}`}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title="Today's study sessions"
          description={
            planner.today.length > 0
              ? `${planner.today.filter((session) => session.status === 'COMPLETED').length} of ${planner.today.length} done`
              : undefined
          }
          action={
            <Link to="/app/planner">
              <Button size="sm" variant="secondary">
                Open planner
              </Button>
            </Link>
          }
        >
          {planner.today.length === 0 ? (
            <EmptyState
              icon={<CalendarClock className="h-6 w-6" />}
              title="Nothing scheduled today"
              description="Generate a study plan from your courses, topics and availability."
              action={
                <Link to="/app/planner">
                  <Button>Generate study plan</Button>
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {planner.today.map((session) => (
                <li key={session.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {courseName(session.courseId)}
                      {topicTitle(session.topicId) && (
                        <span className="text-muted"> · {topicTitle(session.topicId)}</span>
                      )}
                    </p>
                    <p className="text-sm text-muted">
                      {session.startTime}–{session.endTime} ·{' '}
                      {formatDuration(session.durationMinutes)}
                    </p>
                  </div>
                  {session.status === 'SCHEDULED' ? (
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        icon={<Check className="h-4 w-4" />}
                        onClick={() => {
                          completeSession(user.id, session.id);
                          toast('Session completed. Streak updated.');
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

        <div className="grid gap-4">
          <Card title="Upcoming deadlines">
            {upcomingEvents.length === 0 && openTasks.length === 0 ? (
              <p className="text-sm text-muted">Nothing due. Add exams and assignments in the planner.</p>
            ) : (
              <ul className="grid gap-2 text-sm">
                {upcomingEvents.map((event) => (
                  <li key={event.id} className="flex items-center gap-2">
                    <Badge
                      tone={
                        event.type === 'EXAM' ? 'danger' : event.type === 'TEST' ? 'warning' : 'neutral'
                      }
                    >
                      {event.type}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate">{event.title}</span>
                    <span className="tabular text-muted">{event.date}</span>
                  </li>
                ))}
                {openTasks.map((task) => (
                  <li key={task.id} className="flex items-center gap-2">
                    <Badge>TASK</Badge>
                    <span className="min-w-0 flex-1 truncate">{task.title}</span>
                    <span className="tabular text-muted">{task.dueDate ?? '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Academic progress">
            <Progress
              value={topicProgress}
              label={`${termTopics.filter((topic) => topic.done).length}/${termTopics.length} topics done this term`}
            />
            <p className="mt-3 flex items-center gap-1.5 text-sm text-muted">
              <TrendIcon className="h-4 w-4" />
              {metrics.trend === 'NONE'
                ? 'Record results to see your trend.'
                : metrics.trend === 'FLAT'
                  ? 'Your GPA is holding steady.'
                  : metrics.trend === 'UP'
                    ? 'Your GPA is trending up.'
                    : 'Your GPA dipped last term.'}
            </p>
          </Card>
        </div>
      </div>

      <Card className="mt-4" title="Performance" description="Term GPA against cumulative CGPA.">
        {metrics.history.length === 0 ? (
          <EmptyState
            title="No results yet"
            description="Record your grades to see GPA history and projections."
            action={
              <Link to="/app/record">
                <Button>Record results</Button>
              </Link>
            }
          />
        ) : (
          <GpaHistoryChart history={metrics.history} scale={metrics.scale} />
        )}
      </Card>
    </>
  );
}
