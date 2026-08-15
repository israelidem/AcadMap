/**
 * Dashboard — today first, then trajectory.
 *
 * Order follows the PRD: greeting, GPA/CGPA, today's sessions, upcoming
 * deadlines, streak, progress, performance chart.
 *
 * The head of the page is the record itself: the CGPA stamped on the left, and
 * beside it the unit ledger that explains where that figure came from. Every
 * other figure on the page is a supporting column, printed smaller.
 */

import { Link } from 'react-router-dom';
import { CalendarClock, Check, SkipForward, TrendingDown, TrendingUp } from 'lucide-react';
import { formatDuration, todayStr } from '@shared/time';
import { effectiveResults, round } from '@shared/gpa';
import { completeSession, skipSession } from '@/lib/actions';
import { useAcademicMetrics, usePlannerMetrics, useSession, useUserData } from '@/lib/hooks';
import { GpaHistoryChart } from '@/components/charts';
import { RecordPlate, UnitLedger, type LedgerEntry } from '@/components/ledger';
import { Badge, Button, Card, EmptyState, PageHeader, Progress, useToast } from '@/components/ui';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** A small ruled figure: the columns that flank the stamped CGPA. */
function Figure({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="border-t border-rule pt-2 first:border-t-0 first:pt-0 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0 sm:first:border-l-0 sm:first:pl-0">
      <p className="am-eyebrow">{label}</p>
      <p className="tabular mt-1 text-xl font-medium leading-none">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  );
}

export default function Dashboard() {
  const { user, profile } = useSession();
  const toast = useToast();
  const metrics = useAcademicMetrics();
  const planner = usePlannerMetrics();
  // Announcements are delivered to the notification centre (see
  // `useAnnouncementDelivery`) rather than shown as a banner here.
  const { courses, topics, events, tasks, terms, results } = useUserData(user?.id ?? null);


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

  /*
   * The ledger plots the term being worked on. With no current term — or no
   * results in it yet — it falls back to the whole record, because an empty
   * strip would say less than the student's history does.
   */
  const counted = effectiveResults(results).filter((result) => result.countsInGpa);
  const termCounted = currentTerm
    ? counted.filter((result) => result.termId === currentTerm.id)
    : [];
  const plotted = termCounted.length > 0 ? termCounted : counted;
  const ledgerEntries: LedgerEntry[] = plotted.map((result) => ({
    code: result.courseCode || result.courseName.slice(0, 6),
    name: result.courseName,
    units: result.units,
    gradePoint: result.gradePoint,
    gradeName: result.gradeName,
  }));
  const ledgerIsTerm = termCounted.length > 0;

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

      {/* ---------------------------- The record head --------------------------- */}
      <section className="am-card overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
          <div className="border-b border-rule p-4 sm:p-5 lg:border-b-0 lg:border-r">
            <RecordPlate
              label="CGPA"
              value={metrics.cgpa.toFixed(2)}
              outOf={String(round(metrics.scale, 2))}
              note={`${metrics.completedUnits} unit${metrics.completedUnits === 1 ? '' : 's'} counted · ${round(metrics.qualityPoints, 2)} quality points`}
            />

            <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-2">
              <Figure
                label="Term GPA"
                value={metrics.termGpa.toFixed(2)}
                sub={`${metrics.termUnits} unit${metrics.termUnits === 1 ? '' : 's'} recorded`}
              />
              <Figure
                label="Study streak"
                value={`${planner.streak.current}d`}
                sub={`longest ${planner.streak.longest}d`}
              />
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="am-tab-label text-sm font-semibold uppercase tracking-[0.06em]">
                Unit ledger
              </h2>
              <p className="font-mono text-micro uppercase text-muted">
                {ledgerEntries.length === 0
                  ? 'No results recorded'
                  : ledgerIsTerm
                    ? currentTerm?.label
                    : 'Whole record'}
              </p>
            </div>

            {ledgerEntries.length === 0 ? (
              <EmptyState
                title="Nothing to plot yet"
                description="Record a result and the ledger shows which courses carry your CGPA, and which are pulling it down."
                action={
                  <Link to="/app/record">
                    <Button>Record results</Button>
                  </Link>
                }
              />
            ) : (
              <UnitLedger
                entries={ledgerEntries}
                scale={metrics.scale}
                average={ledgerIsTerm ? metrics.termGpa : metrics.cgpa}
                averageLabel={ledgerIsTerm ? 'Term GPA' : 'CGPA'}
              />
            )}
          </div>
        </div>
      </section>

      {/* ------------------------------ Today's work ---------------------------- */}
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
            <ul className="divide-y divide-rule">
              {planner.today.map((session) => (
                <li key={session.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {courseName(session.courseId)}
                      {topicTitle(session.topicId) && (
                        <span className="text-muted"> · {topicTitle(session.topicId)}</span>
                      )}
                    </p>
                    <p className="tabular mt-0.5 text-xs text-muted">
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
              <ul className="divide-y divide-rule text-sm">
                {upcomingEvents.map((event) => (
                  <li key={event.id} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                    <Badge
                      tone={
                        event.type === 'EXAM' ? 'danger' : event.type === 'TEST' ? 'warning' : 'neutral'
                      }
                    >
                      {event.type}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate">{event.title}</span>
                    <span className="tabular text-xs text-muted">{event.date}</span>
                  </li>
                ))}
                {openTasks.map((task) => (
                  <li key={task.id} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                    <Badge>TASK</Badge>
                    <span className="min-w-0 flex-1 truncate">{task.title}</span>
                    <span className="tabular text-xs text-muted">{task.dueDate ?? '—'}</span>
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
              <TrendIcon className="h-4 w-4 shrink-0" />
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
