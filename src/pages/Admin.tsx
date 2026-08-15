/**
 * AcadMap Admin — internal control centre for the designated owner.
 *
 * The route is only reachable when `useSession().isOwner` is true, and every
 * mutation is recorded in the admin activity log. This is not a generic
 * super-admin panel: no billing, infrastructure or database tooling.
 *
 * Presentation is deliberately unlike the student app. Where a student sees
 * their own record on manila paper, the owner sees the desk it is filed on:
 * graphite stock, a numbered index down the left, and every measurement in one
 * ledger column rather than a grid of tinted cards. The reason is practical —
 * twelve cards take twelve glances, one column takes one — and it keeps the
 * screen where accounts get suspended from ever looking like the screen where
 * courses get added.
 */

import { useMemo, useState } from 'react';
import type { FeatureFlags, FeedbackStatus } from '@shared/types';
import { dailyCounts, daysAgoIso } from '@/lib/analytics';
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
import {
  ActivityPlot,
  BlankRegister,
  FiguresLedger,
  OpsShell,
  RegisterHead,
  Segmented,
  type FigureGroup,
} from '@/components/ops';
import { Badge, Button, Card, EmptyState, Input, Select, Toggle, useToast } from '@/components/ui';

const RANGES = [
  { value: '1', label: 'Today' },
  { value: '7', label: '7d' },
  { value: '30', label: '30d' },
  { value: '90', label: '90d' },
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
 * Accounts as a funnel, because that is the only shape in which those three
 * numbers mean anything.
 *
 * "Registered 40 / Onboarded 12 / Active 3" in three separate boxes hides the
 * finding; drawn to a common scale it states it: two thirds of the people who
 * signed up never finished setting up. Bars are ruled to the same baseline so
 * the drop-off is a length you can see rather than a division you must do.
 */
function AccountFunnel({
  registered,
  onboarded,
  active,
  suspended,
  deleted,
}: {
  registered: number;
  onboarded: number;
  active: number;
  suspended: number;
  deleted: number;
}) {
  const steps = [
    { label: 'Registered', value: registered, note: 'accounts created' },
    { label: 'Onboarded', value: onboarded, note: 'finished setup' },
    { label: 'Studying', value: active, note: 'a session in the last 48h' },
  ];

  return (
    <div>
      <ul className="space-y-3">
        {steps.map((step, index) => {
          const share = registered > 0 ? step.value / registered : 0;
          return (
            <li key={step.label}>
              {/*
               * Label above, bar below. A three-column row (label | bar | count)
               * leaves the bar about 70px wide in this 20rem column, which is too
               * short to compare lengths — the one job the bar has.
               */}
              <div className="flex items-baseline justify-between gap-2">
                <span className="am-eyebrow truncate">{step.label}</span>
                <span className="shrink-0">
                  <span className="tabular text-lg leading-none">{step.value}</span>
                  <span className="tabular ml-1.5 text-[10px] text-muted">
                    {registered > 0 ? `${Math.round(share * 100)}%` : '—'}
                  </span>
                </span>
              </div>

              <span className="mt-1.5 block h-2.5 border border-border bg-surface-2">
                <span
                  className={cn(
                    'block h-full origin-left animate-tally',
                    index === 0 ? 'bg-brand' : index === 1 ? 'bg-brand/55' : 'bg-accent',
                  )}
                  style={{ width: `${Math.max(share * 100, step.value > 0 ? 2 : 0)}%` }}
                />
              </span>
            </li>
          );
        })}
      </ul>


      <p className="mt-3 border-t border-rule pt-2 font-mono text-[10px] uppercase text-muted">
        {steps[2].note}
        {(suspended > 0 || deleted > 0) && (
          <>
            {' · '}
            <span className="text-warning">{suspended} suspended</span>
            {' · '}
            <span className="text-danger">{deleted} deleted</span>
          </>
        )}
      </p>
    </div>
  );
}

/** Status as a stamp, in the ink that matches the consequence. */
function StatusStamp({ status }: { status: string }) {
  const tone =
    status === 'ACTIVE' || status === 'RESOLVED' || status === 'PUBLISHED'
      ? 'success'
      : status === 'SUSPENDED' || status === 'IN_PROGRESS' || status === 'DRAFT'
        ? 'warning'
        : status === 'DELETED'
          ? 'danger'
          : 'neutral';

  return <Badge tone={tone}>{status}</Badge>;
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
  /*
   * A chart of a single day is a single bar, which says nothing. The range picker
   * governs the counters; the chart always shows at least a fortnight of context.
   */
  const chartDays = Math.max(14, days);

  /*
   * The three series are kept apart rather than summed. A rise in app opens with
   * flat results recorded is a different product problem from a rise in both,
   * and the old single-series chart could not tell them apart.
   */
  const plot = useMemo(
    () => [
      { label: 'Opens', values: dailyCounts(['app_opened'], chartDays), tone: 'soft' as const },
      {
        label: 'Results',
        values: dailyCounts(['result_recorded'], chartDays),
        tone: 'brand' as const,
      },
      {
        label: 'Sessions',
        values: dailyCounts(['session_completed'], chartDays),
        tone: 'accent' as const,
      },
    ],
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

  const openFeedback = db.feedback.filter((item) => item.status === 'OPEN').length;

  // Checked after the hooks above so the hook order cannot change when the role
  // does; the server repeats this check on every admin request regardless.
  if (!user || !isOwner) {
    return (
      <div className="am-ops min-h-screen bg-bg px-4 py-16">
        <div className="mx-auto max-w-md">
          <Card>
            <EmptyState
              title="403 — Not authorised"
              description="The AcadMap admin console is restricted to the owner account."
            />
          </Card>
        </div>
      </div>
    );
  }

  const overviewGroups: FigureGroup[] = [
    {
      label: 'Sign-ups',
      description: 'people arriving, and getting as far as a usable account',
      figures: [
        { label: 'New registrations', event: 'registered' },
        { label: 'Onboardings completed', event: 'onboarding_completed' },
      ],
    },
    {
      label: 'Work recorded',
      description: 'what students actually did in this period',
      figures: [
        { label: 'Courses created', event: 'course_created' },
        { label: 'Results recorded', event: 'result_recorded' },
        { label: 'Plans generated', event: 'plan_generated' },
        { label: 'Sessions completed', event: 'session_completed' },
      ],
    },
  ];

  const analyticsGroups: FigureGroup[] = [
    {
      label: 'Engagement',
      description: 'coming back, and using the tools',
      figures: [
        { label: 'App opens', event: 'app_opened' },
        { label: 'GPA calculations', event: 'gpa_calculated' },
        { label: 'Registrations', event: 'registered' },
        { label: 'Onboardings', event: 'onboarding_completed' },
      ],
    },
    {
      label: 'Academic work',
      description: 'records a student keeps up to date',
      figures: [
        { label: 'Courses created', event: 'course_created' },
        { label: 'Results entered', event: 'result_recorded' },
        { label: 'Snapshots shared', event: 'snapshot_created' },
        {
          label: 'Active goals',
          value: db.goals.filter((goal) => !goal.achievedAt).length,
          note: 'open right now',
        },
      ],
    },
    {
      label: 'Planning',
      description: 'whether a generated plan turns into study that happens',
      figures: [
        { label: 'Plans generated', event: 'plan_generated' },
        { label: 'Sessions completed', event: 'session_completed' },
        { label: 'Sessions skipped', event: 'session_skipped', inverse: true },
        {
          label: 'Scheduled sessions',
          value: db.sessions.filter((session) => session.status === 'SCHEDULED').length,
          note: 'still ahead',
        },
      ],
    },
  ];

  const rangeControl = (
    <Segmented value={range} onChange={setRange} options={RANGES} label="Reporting period" />
  );

  return (
    <OpsShell
      email={user.email}
      active={tab}
      onChange={setTab}
      toolbar={tab === 'overview' || tab === 'analytics' ? rangeControl : undefined}
      sections={[
        { value: 'overview', label: 'Overview' },
        { value: 'users', label: 'Users', count: students.length },
        { value: 'analytics', label: 'Analytics' },
        { value: 'institutions', label: 'Institutions', count: institutions.length },
        { value: 'feedback', label: 'Feedback', count: openFeedback },
        { value: 'announcements', label: 'Announcements', count: db.announcements.length },
        { value: 'flags', label: 'Feature controls' },
        { value: 'log', label: 'Activity log', count: db.activityLogs.length },
      ]}
    >
      {tab === 'overview' && (
        <div className="space-y-5">
          {/*
           * A brand-new instance used to greet the owner with twelve bold zeros,
           * which reads as a broken deployment. Say plainly that it is empty, and
           * why analytics may look empty even when the product is live.
           */}
          {db.usageEvents.length === 0 && students.length === 0 && (
            <Card title="New instance">
              <p className="max-w-2xl text-sm leading-relaxed text-muted">
                Nothing has been recorded on this device yet. Usage counters and the activity plot
                are stored locally in the browser you are reading them in, so a fresh browser —
                or a private window — always starts at zero, even when students are using the app
                elsewhere. Accounts, feedback and announcements below are read from the database
                and are accurate.
              </p>
            </Card>
          )}

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <Card
              title="Daily activity"
              description={`Opens, results and sessions per day over ${chartDays} days.`}
            >
              <ActivityPlot series={plot} days={chartDays} />
            </Card>

            <Card title="Accounts" description="How far people get after signing up.">
              {students.length === 0 ? (
                <BlankRegister
                  title="No accounts yet"
                  description="Registered students appear here as soon as the first account is created."
                />
              ) : (
                <AccountFunnel
                  registered={students.length}
                  onboarded={onboarded}
                  active={activeStreaks}
                  suspended={students.filter((row) => row.status === 'SUSPENDED').length}
                  deleted={students.filter((row) => row.status === 'DELETED').length}
                />
              )}
            </Card>
          </div>

          <Card
            title="Figures"
            description={`Counted over the selected period, against the ${days} days before it.`}
            bodyClassName="px-4 pb-4 pt-0 sm:px-5"
          >
            <FiguresLedger groups={overviewGroups} days={days} />
          </Card>
        </div>
      )}

      {tab === 'users' && (
        <Card
          title="Users"
          description="Only the account details needed for support — never private academic records."
          action={
            <span className="am-eyebrow whitespace-nowrap">
              <span className="tabular text-fg">{filteredUsers.length}</span>
              {filteredUsers.length === students.length ? ' total' : ` of ${students.length}`}
            </span>
          }
        >
          <Input
            label="Search"
            placeholder="Name, email, institution or programme"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          {/* Seven columns of support detail: scrolled, never squeezed. */}
          <div className="am-scroll-x mt-4">
            {filteredUsers.length === 0 ? (
              <BlankRegister
                title={search ? 'No matching students' : 'No students yet'}
                description={
                  search
                    ? 'Nothing matches that search. Try an email fragment, an institution or a programme.'
                    : 'Accounts appear in this register the moment a student registers.'
                }
              />
            ) : (
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <RegisterHead
                  columns={[
                    { label: 'Student' },
                    { label: 'Institution' },
                    { label: 'Programme' },
                    { label: 'Level' },
                    { label: 'Joined' },
                    { label: 'Status' },
                    { label: 'Actions', align: 'right' },
                  ]}
                />
                <tbody>
                  {filteredUsers.map((row) => {
                    const profile = profileOf(row.id);
                    return (
                      <tr
                        key={row.id}
                        className={cn(
                          'border-b border-rule transition-colors hover:bg-surface-2/50',
                          // A closed account should not read as a live one.
                          row.status === 'DELETED' && 'opacity-55',
                        )}
                      >
                        <td className="py-2.5 pr-4">
                          <p className="font-medium">{profile?.fullName || '—'}</p>
                          <p className="font-mono text-xs text-muted">{row.email}</p>
                        </td>
                        <td className="py-2.5 pr-4">{profile?.institution || '—'}</td>
                        <td className="py-2.5 pr-4">{profile?.programme || '—'}</td>
                        <td className="tabular py-2.5 pr-4">{profile?.level || '—'}</td>
                        <td className="tabular py-2.5 pr-4 text-xs text-muted">
                          {row.createdAt.slice(0, 10)}
                        </td>
                        <td className="py-2.5 pr-4">
                          <StatusStamp status={row.status} />
                        </td>
                        <td className="py-2.5">
                          <div className="flex justify-end gap-1.5">
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
            )}
          </div>
        </Card>
      )}

      {tab === 'analytics' && (
        <div className="space-y-5">
          <Card
            title="Figures"
            description={`Counted over the selected period, against the ${days} days before it.`}
            bodyClassName="px-4 pb-4 pt-0 sm:px-5"
          >
            <FiguresLedger groups={analyticsGroups} days={days} />
          </Card>

          <Card title="Daily activity" description="The same series as the overview, for reference.">
            <ActivityPlot series={plot} days={chartDays} />
          </Card>
        </div>
      )}

      {tab === 'institutions' && (
        <Card title="Institutions" description="Aggregated counts only — no individual records.">
          {institutions.length === 0 ? (
            <BlankRegister
              title="No institutions recorded"
              description="An institution is written here once a student names theirs during onboarding."
            />
          ) : (
            <table className="w-full border-collapse text-sm">
              <RegisterHead
                columns={[
                  { label: 'Institution' },
                  { label: 'Share' },
                  { label: 'Students', align: 'right' },
                ]}
              />
              <tbody>
                {institutions.map(([name, count]) => (
                  <tr key={name} className="border-b border-rule hover:bg-surface-2/50">
                    <td className="py-2.5 pr-4 font-medium">{name}</td>
                    {/* The bar is the point: one institution carrying the product
                        is a different business from thirty carrying it evenly. */}
                    <td className="w-1/2 py-2.5 pr-4">
                      <span className="block h-2 border border-border bg-surface-2">
                        <span
                          className="block h-full origin-left animate-tally bg-brand"
                          style={{ width: `${(count / students.length) * 100}%` }}
                        />
                      </span>
                    </td>
                    <td className="tabular py-2.5 text-right">{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === 'feedback' && (
        <Card
          title="Feedback & bug reports"
          description="Submitted from the app by students and guests."
          action={
            openFeedback > 0 ? (
              <span className="am-eyebrow whitespace-nowrap text-warning">
                <span className="tabular">{openFeedback}</span> open
              </span>
            ) : undefined
          }
        >
          {db.feedback.length === 0 ? (
            <BlankRegister
              title="No submissions"
              description="Reports sent from the feedback form in the student app are filed here."
            />
          ) : (
            <ul className="divide-y divide-rule">
              {db.feedback.map((item) => (
                <li key={item.id} className="grid gap-2 py-3.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <Badge tone={item.category === 'BUG' ? 'danger' : 'neutral'}>
                      {item.category}
                    </Badge>
                    <span className="font-mono text-xs text-muted">
                      {item.userEmail ?? 'anonymous'}
                    </span>
                    <span className="tabular text-xs text-muted">{item.createdAt.slice(0, 10)}</span>

                    <div className="ml-auto flex items-center gap-2">
                      <StatusStamp status={item.status} />
                      <Select
                        label=""
                        aria-label={`Status for report from ${item.userEmail ?? 'anonymous'}`}
                        className="w-36"
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
                  {/* The report itself, set apart the way a quoted statement is. */}
                  <p className="border-l-2 border-border pl-3 text-sm leading-relaxed">
                    {item.message}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'announcements' && (
        <div className="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <Card title="New announcement" description="Created as a draft; published separately.">
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
              <BlankRegister
                title="Nothing filed"
                description="Drafts and published notices are listed here, newest first."
              />
            ) : (
              <ul className="divide-y divide-rule">
                {db.announcements.map((announcement) => (
                  <li key={announcement.id} className="grid gap-2 py-3.5 first:pt-0 last:pb-0">
                    <div className="flex items-start gap-3">
                      <p className="min-w-0 flex-1 font-medium">{announcement.title}</p>
                      <StatusStamp status={announcement.status} />
                    </div>
                    <p className="text-sm leading-relaxed text-muted">{announcement.body}</p>
                    <div className="am-row-x gap-1.5">
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
          bodyClassName="px-4 py-1 sm:px-5"
        >
          <ul className="divide-y divide-rule">
            {(Object.keys(FLAG_LABELS) as (keyof FeatureFlags)[]).map((flag) => {
              const on = db.featureFlags[flag];
              return (
                <li key={flag} className="flex items-center justify-between gap-4 py-3">
                  <Toggle
                    label={FLAG_LABELS[flag]}
                    checked={on}
                    onChange={(value) => setFeatureFlag(user.email, flag, value)}
                  />
                  {/* The state in words as well as in the switch: a control this
                      consequential should not be read by position alone. */}
                  <span
                    className={cn(
                      'font-mono text-micro uppercase',
                      on ? 'text-success' : 'text-muted',
                    )}
                  >
                    {on ? 'Enabled' : 'Off'}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {tab === 'log' && (
        <Card title="Admin activity log" description="An audit trail of owner actions.">
          {db.activityLogs.length === 0 ? (
            <BlankRegister
              title="No actions recorded"
              description="Suspensions, publications and flag changes are written here as they happen."
            />
          ) : (
            <div className="am-scroll-x">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <RegisterHead
                  columns={[
                    { label: 'Action' },
                    { label: 'Resource' },
                    { label: 'Recorded', align: 'right' },
                  ]}
                />
                <tbody>
                  {db.activityLogs.map((entry) => (
                    <tr key={entry.id} className="border-b border-rule hover:bg-surface-2/50">
                      <td className="py-2 pr-4 font-mono text-xs uppercase">{entry.action}</td>
                      <td className="py-2 pr-4 text-muted">{entry.resource}</td>
                      <td className="tabular py-2 text-right text-xs text-muted">
                        {entry.createdAt.replace('T', ' ').slice(0, 16)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </OpsShell>
  );
}
