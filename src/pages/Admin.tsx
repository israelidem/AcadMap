/**
 * AcadMap Admin — internal control centre for the designated owner.
 *
 * The route is only reachable when `useSession().isOwner` is true, and every
 * mutation is recorded in the admin activity log. This is not a generic
 * super-admin panel: no billing, infrastructure or database tooling.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  CalendarCheck,
  Flame,
  GraduationCap,
  Minus,
  Share2,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingDown,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { FeatureFlags, FeedbackStatus } from '@shared/types';
import { countEvents, dailyCounts, daysAgoIso, trend } from '@/lib/analytics';
import {
  createAnnouncement,
  deleteAnnouncement,
  setFeatureFlag,
  setUserStatus,
  updateAnnouncement,
  updateFeedbackStatus,
} from '@/lib/actions';
import { useSession } from '@/lib/hooks';
import { useDb } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Tabs } from '@/components/tabs';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Toggle,
  useToast,
} from '@/components/ui';

const RANGES = [
  { value: '1', label: 'Today' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

const FLAG_LABELS: Record<keyof FeatureFlags, string> = {
  gpaCalculatorEnabled: 'GPA calculator',
  gpaProjectionEnabled: 'GPA projection',
  plannerEnabled: 'Study planner',
  goalsEnabled: 'Goals',
  streaksEnabled: 'Study streaks',
  sharingEnabled: 'Sharing',
  notificationsEnabled: 'Browser notifications',
};

const FEEDBACK_STATUSES: FeedbackStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

/* ------------------------------ presentation ------------------------------ */

/**
 * One number, with the two things that make a number mean something: what it
 * measures, and which way it is moving.
 *
 * The dashboard was a grid of identical bordered boxes, each holding a label and
 * a figure. Nothing stood out because nothing was distinguished — a hard zero
 * read the same as a healthy count, and no card said whether this period had
 * been better or worse than the one before it.
 */
function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  change,
  tone = 'brand',
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  sub?: string;
  /** Ratio against the previous period; null when there is nothing to compare. */
  change?: number | null;
  tone?: 'brand' | 'success' | 'warning' | 'muted';
}) {
  const tones = {
    brand: 'bg-brand-soft text-brand',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    muted: 'bg-surface-2 text-muted',
  } as const;

  const rising = typeof change === 'number' && change > 0;
  const falling = typeof change === 'number' && change < 0;
  const percent = typeof change === 'number' ? `${Math.abs(Math.round(change * 100))}%` : null;

  return (
    <div className="am-card flex flex-col gap-3 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-medium text-muted">{label}</p>
        <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', tones[tone])}>
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
      </div>

      <p className="tabular text-3xl font-semibold leading-none">{value}</p>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        {percent && (
          <span
            className={cn(
              'inline-flex items-center gap-1 font-medium',
              rising && 'text-success',
              falling && 'text-danger',
            )}
          >
            {rising ? (
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            ) : falling ? (
              <TrendingDown className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Minus className="h-3.5 w-3.5" aria-hidden />
            )}
            {percent}
            <span className="font-normal text-muted">vs previous</span>
          </span>
        )}
        {sub && <span>{sub}</span>}
      </div>
    </div>
  );
}

/**
 * Daily activity as bars.
 *
 * Deliberately spare: the shape is the message — whether use is growing, flat or
 * concentrated in a couple of days — and axis furniture at this size costs more
 * room than it earns. Each bar carries its date and count as a tooltip, and the
 * chart as a whole is described for assistive technology.
 */
function DailyBars({ series, label, days }: { series: number[]; label: string; days: number }) {
  const peak = Math.max(1, ...series);
  const total = series.reduce((sum, count) => sum + count, 0);

  return (
    <div>
      <div
        className="flex h-28 items-end gap-[3px]"
        role="img"
        aria-label={`${label}: ${total} over ${days} day${days === 1 ? '' : 's'}`}
      >
        {series.map((count, index) => (
          <div
            key={index}
            title={`${new Date(Date.now() - (series.length - 1 - index) * 86_400_000)
              .toDateString()
              .slice(4)} — ${count}`}
            className={cn(
              'min-h-[3px] flex-1 rounded-t',
              count === 0 ? 'bg-surface-2' : 'bg-brand/80',
            )}
            style={{ height: `${Math.max(3, (count / peak) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted">
        <span>{days === 1 ? 'Today' : `${days} days ago`}</span>
        <span className="tabular">peak {peak}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

/** A titled band of metrics, so twelve numbers read as three ideas. */
function MetricSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
    </section>
  );
}


export default function Admin() {
  const { user, isOwner } = useSession();
  const toast = useToast();
  const [tab, setTab] = useState('overview');
  const [range, setRange] = useState('30');
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const db = useDb((current) => current);

  const days = Number(range);
  const since = daysAgoIso(days);
  /*
   * A chart of a single day is a single bar, which says nothing. The range picker
   * governs the counters; the chart always shows at least a week of context.
   */
  const chartDays = Math.max(7, days);
  const activity = useMemo(
    () => dailyCounts(['app_opened', 'result_recorded', 'session_completed'], chartDays),
    // The database object changes identity on every write, which is the signal
    // that a recount is due.
    [chartDays, db],
  );

  const students = db.users.filter((row) => row.role !== 'OWNER');
  const profileOf = (userId: string) => db.profiles.find((row) => row.userId === userId);

  const onboarded = students.filter((row) => profileOf(row.id)?.onboardingCompletedAt).length;
  const activeStreaks = db.users.filter((row) =>
    db.sessions.some(
      (session) =>
        session.userId === row.id &&
        session.status === 'COMPLETED' &&
        session.date >= daysAgoIso(2).slice(0, 10),
    ),
  ).length;

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return students;
    return students.filter((row) => {
      const profile = profileOf(row.id);
      return [row.email, profile?.fullName, profile?.institution, profile?.programme]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [search, students, db.profiles]);

  const institutions = useMemo(() => {
    const counts = new Map<string, number>();
    students.forEach((row) => {
      const name = profileOf(row.id)?.institution?.trim();
      if (!name) return;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [students, db.profiles]);

  // Checked after the hooks above so the hook order cannot change when the role
  // does; the server repeats this check on every admin request regardless.
  if (!user || !isOwner) {
    return (
      <Card>
        <EmptyState
          icon={<ShieldAlert className="h-6 w-6" />}
          title="403 — Not authorised"
          description="The AcadMap admin dashboard is restricted to the owner account."
        />
      </Card>
    );
  }

  return (
    <>
      {/* The installed PWA has no browser chrome, so this is the only way back. */}
      <Link
        to="/app"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to AcadMap
      </Link>

      <PageHeader
        title="AcadMap admin"
        description="Understand, manage and improve the student experience."
        action={
          <Select
            label=""
            className="w-40"
            value={range}
            onChange={(event) => setRange(event.target.value)}
          >
            {RANGES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'users', label: 'Users' },
          { value: 'analytics', label: 'Analytics' },
          { value: 'institutions', label: 'Institutions' },
          { value: 'feedback', label: 'Feedback' },
          { value: 'announcements', label: 'Announcements' },
          { value: 'flags', label: 'Feature controls' },
          { value: 'log', label: 'Activity log' },
        ]}
      />

      {tab === 'overview' && (
        <>
          <MetricSection
            title="Students"
            description="Who has an account, and how far they got with setting it up."
          >
            <MetricCard
              icon={Users}
              label="Registered students"
              value={students.length}
              sub={`${students.filter((row) => row.status === 'ACTIVE').length} active`}
            />
            <MetricCard
              icon={UserPlus}
              label="New registrations"
              value={countEvents('registered', since)}
              change={trend('registered', days)}
            />
            <MetricCard
              icon={Sparkles}
              tone="success"
              label="Onboarding completed"
              value={onboarded}
              sub={
                students.length > 0
                  ? `${Math.round((onboarded / students.length) * 100)}% of accounts`
                  : 'no accounts yet'
              }
            />
            <MetricCard
              icon={Flame}
              tone="warning"
              label="Active study streaks"
              value={activeStreaks}
              sub="studied in the last two days"
            />
          </MetricSection>

          <MetricSection
            title="Work recorded"
            description="What students actually did with AcadMap in this period."
          >
            <MetricCard
              icon={BookOpen}
              label="Courses created"
              value={countEvents('course_created', since)}
              change={trend('course_created', days)}
            />
            <MetricCard
              icon={GraduationCap}
              label="Results recorded"
              value={countEvents('result_recorded', since)}
              change={trend('result_recorded', days)}
            />
            <MetricCard
              icon={CalendarCheck}
              label="Plans generated"
              value={countEvents('plan_generated', since)}
              change={trend('plan_generated', days)}
            />
            <MetricCard
              icon={Target}
              label="Sessions completed"
              value={countEvents('session_completed', since)}
              change={trend('session_completed', days)}
            />
          </MetricSection>

          <Card
            title="Daily activity"
            description="App opens, results recorded and sessions completed, by day."
          >
            {activity.every((count) => count === 0) ? (
              <EmptyState
                icon={<BarChart3 className="h-6 w-6" />}
                title="No activity recorded yet"
                description="Counts appear here as students open the app and record their work. Analytics are stored on this device, so a fresh browser starts empty."
              />
            ) : (
              <DailyBars series={activity} label="Daily activity" days={chartDays} />
            )}
          </Card>
        </>
      )}

      {tab === 'users' && (
        <Card
          title="Users"
          description="Only the account details needed for support — never private academic records."
        >
          <Input
            label="Search"
            placeholder="Name, email, institution or programme"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {/* Seven columns of support detail: scrolled, never squeezed. */}
          <div className="am-scroll-x mt-4">
            <table className="w-full min-w-[760px] text-sm">

              <thead className="text-left text-muted">
                <tr>
                  <th className="py-2 pr-4 font-medium">Student</th>
                  <th className="py-2 pr-4 font-medium">Institution</th>
                  <th className="py-2 pr-4 font-medium">Programme</th>
                  <th className="py-2 pr-4 font-medium">Level</th>
                  <th className="py-2 pr-4 font-medium">Joined</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((row) => {
                  const profile = profileOf(row.id);
                  return (
                    <tr key={row.id} className="border-t border-border">
                      <td className="py-2 pr-4">
                        <p className="font-medium">{profile?.fullName || '—'}</p>
                        <p className="text-muted">{row.email}</p>
                      </td>
                      <td className="py-2 pr-4">{profile?.institution || '—'}</td>
                      <td className="py-2 pr-4">{profile?.programme || '—'}</td>
                      <td className="py-2 pr-4">{profile?.level || '—'}</td>
                      <td className="py-2 pr-4">{row.createdAt.slice(0, 10)}</td>
                      <td className="py-2 pr-4">
                        <Badge
                          tone={
                            row.status === 'ACTIVE'
                              ? 'success'
                              : row.status === 'SUSPENDED'
                                ? 'warning'
                                : 'danger'
                          }
                        >
                          {row.status}
                        </Badge>
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1.5">
                          {row.status === 'ACTIVE' ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setUserStatus(user.email, row.id, 'SUSPENDED');
                                toast('Account suspended.');
                              }}
                            >
                              Suspend
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setUserStatus(user.email, row.id, 'ACTIVE');
                                toast('Account restored.');
                              }}
                            >
                              Restore
                            </Button>
                          )}
                          {row.status !== 'DELETED' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setUserStatus(user.email, row.id, 'DELETED');
                                toast('Account soft-deleted.');
                              }}
                            >
                              Soft-delete
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredUsers.length === 0 && (
              <p className="py-6 text-center text-sm text-muted">No matching students.</p>
            )}
          </div>
        </Card>
      )}

      {tab === 'analytics' && (
        <>
          <MetricSection title="Engagement" description="Coming back, and using the tools.">
            <MetricCard
              icon={BarChart3}
              label="App opens"
              value={countEvents('app_opened', since)}
              change={trend('app_opened', days)}
            />
            <MetricCard
              icon={GraduationCap}
              label="GPA calculations"
              value={countEvents('gpa_calculated', since)}
              change={trend('gpa_calculated', days)}
            />
            <MetricCard
              icon={UserPlus}
              label="Registrations"
              value={countEvents('registered', since)}
              change={trend('registered', days)}
            />
            <MetricCard
              icon={Sparkles}
              label="Onboardings"
              value={countEvents('onboarding_completed', since)}
              change={trend('onboarding_completed', days)}
            />
          </MetricSection>

          <MetricSection title="Academic work" description="Records a student keeps up to date.">
            <MetricCard
              icon={BookOpen}
              label="Courses created"
              value={countEvents('course_created', since)}
              change={trend('course_created', days)}
            />
            <MetricCard
              icon={GraduationCap}
              label="Results entered"
              value={countEvents('result_recorded', since)}
              change={trend('result_recorded', days)}
            />
            <MetricCard
              icon={Share2}
              label="Snapshots shared"
              value={countEvents('snapshot_created', since)}
              change={trend('snapshot_created', days)}
            />
            <MetricCard
              icon={Target}
              tone="muted"
              label="Active goals"
              value={db.goals.filter((goal) => !goal.achievedAt).length}
              sub="open right now"
            />
          </MetricSection>

          <MetricSection
            title="Planning"
            description="Whether a generated plan turns into study that happens."
          >
            <MetricCard
              icon={CalendarCheck}
              label="Plans generated"
              value={countEvents('plan_generated', since)}
              change={trend('plan_generated', days)}
            />
            <MetricCard
              icon={Target}
              tone="success"
              label="Sessions completed"
              value={countEvents('session_completed', since)}
              change={trend('session_completed', days)}
            />
            <MetricCard
              icon={Minus}
              tone="warning"
              label="Sessions skipped"
              value={countEvents('session_skipped', since)}
              change={trend('session_skipped', days)}
            />
            <MetricCard
              icon={CalendarCheck}
              tone="muted"
              label="Scheduled sessions"
              value={db.sessions.filter((session) => session.status === 'SCHEDULED').length}
              sub="still ahead"
            />
          </MetricSection>

          <Card title="Daily activity" description="The same series as the overview, for reference.">
            <DailyBars series={activity} label="Daily activity" days={chartDays} />
          </Card>
        </>
      )}


      {tab === 'institutions' && (
        <Card title="Institutions" description="Aggregated counts only — no individual records.">
          {institutions.length === 0 ? (
            <p className="text-sm text-muted">No institutions recorded yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-2 font-medium">Institution</th>
                  <th className="py-2 text-right font-medium">Students</th>
                </tr>
              </thead>
              <tbody>
                {institutions.map(([name, count]) => (
                  <tr key={name} className="border-t border-border">
                    <td className="py-2">{name}</td>
                    <td className="tabular py-2 text-right">{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === 'feedback' && (
        <Card title="Feedback & bug reports">
          {db.feedback.length === 0 ? (
            <p className="text-sm text-muted">No submissions yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {db.feedback.map((item) => (
                <li key={item.id} className="grid gap-2 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={item.category === 'BUG' ? 'danger' : 'neutral'}>
                      {item.category}
                    </Badge>
                    <span className="text-muted">{item.userEmail ?? 'Anonymous'}</span>
                    <span className="text-muted">{item.createdAt.slice(0, 10)}</span>
                    <div className="ml-auto">
                      <Select
                        label=""
                        className="w-40"
                        value={item.status}
                        onChange={(event) =>
                          updateFeedbackStatus(
                            user.email,
                            item.id,
                            event.target.value as FeedbackStatus,
                          )
                        }
                      >
                        {FEEDBACK_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                  <p>{item.message}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'announcements' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="New announcement">
            <div className="grid gap-4">
              <Input label="Title" value={title} onChange={(event) => setTitle(event.target.value)} />
              <Input label="Message" value={body} onChange={(event) => setBody(event.target.value)} />
              <div>
                <Button
                  onClick={() => {
                    if (title.trim().length < 3 || body.trim().length < 3) {
                      toast('Add a title and message.', 'error');
                      return;
                    }
                    createAnnouncement(user.email, title.trim(), body.trim());
                    setTitle('');
                    setBody('');
                    toast('Announcement created as a draft.');
                  }}
                >
                  Create draft
                </Button>
              </div>
            </div>
          </Card>

          <Card title="Announcements">
            {db.announcements.length === 0 ? (
              <p className="text-sm text-muted">Nothing yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {db.announcements.map((announcement) => (
                  <li key={announcement.id} className="grid gap-2 py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate font-medium">{announcement.title}</p>
                      <Badge
                        tone={
                          announcement.status === 'PUBLISHED'
                            ? 'success'
                            : announcement.status === 'ARCHIVED'
                              ? 'neutral'
                              : 'warning'
                        }
                      >
                        {announcement.status}
                      </Badge>
                    </div>
                    <p className="text-muted">{announcement.body}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {announcement.status !== 'PUBLISHED' && (
                        <Button
                          size="sm"
                          onClick={() =>
                            updateAnnouncement(user.email, announcement.id, { status: 'PUBLISHED' })
                          }
                        >
                          Publish
                        </Button>
                      )}
                      {announcement.status === 'PUBLISHED' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            updateAnnouncement(user.email, announcement.id, { status: 'DRAFT' })
                          }
                        >
                          Unpublish
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          updateAnnouncement(user.email, announcement.id, { status: 'ARCHIVED' })
                        }
                      >
                        Archive
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteAnnouncement(user.email, announcement.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === 'flags' && (
        <Card
          title="Feature controls"
          description="Toggles take effect immediately — no redeploy required."
        >
          <div className="grid gap-3">
            {(Object.keys(FLAG_LABELS) as (keyof FeatureFlags)[]).map((flag) => (
              <Toggle
                key={flag}
                label={FLAG_LABELS[flag]}
                checked={db.featureFlags[flag]}
                onChange={(value) => setFeatureFlag(user.email, flag, value)}
              />
            ))}
          </div>
        </Card>
      )}

      {tab === 'log' && (
        <Card title="Admin activity log" description="An audit trail of owner actions.">
          {db.activityLogs.length === 0 ? (
            <p className="text-sm text-muted">No admin actions recorded yet.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {db.activityLogs.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="font-medium">{entry.action}</span>
                  <span className="text-muted">{entry.resource}</span>
                  <span className="ml-auto text-muted">{entry.createdAt.replace('T', ' ').slice(0, 16)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
