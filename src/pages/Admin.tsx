/**
 * AcadMap Admin — internal control centre for the designated owner.
 *
 * The route is only reachable when `useSession().isOwner` is true, and every
 * mutation is recorded in the admin activity log. This is not a generic
 * super-admin panel: no billing, infrastructure or database tooling.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import type { FeatureFlags, FeedbackStatus } from '@shared/types';
import { countEvents, daysAgoIso } from '@/lib/analytics';
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
import { Tabs } from '@/components/tabs';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Stat,
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

export default function Admin() {
  const { user, isOwner } = useSession();
  const toast = useToast();
  const [tab, setTab] = useState('overview');
  const [range, setRange] = useState('30');
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const db = useDb((current) => current);

  const since = daysAgoIso(Number(range));
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
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Registered students" value={students.length} tone="brand" />
          <Stat label="New registrations" value={countEvents('registered', since)} />
          <Stat
            label="Onboarding completed"
            value={onboarded}
            sub={students.length > 0 ? `${Math.round((onboarded / students.length) * 100)}%` : '—'}
          />
          <Stat label="Active study streaks" value={activeStreaks} />
          <Stat label="Courses created" value={countEvents('course_created', since)} />
          <Stat label="Results recorded" value={countEvents('result_recorded', since)} />
          <Stat label="Plans generated" value={countEvents('plan_generated', since)} />
          <Stat label="Sessions completed" value={countEvents('session_completed', since)} />
        </div>
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
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
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
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="App opens" value={countEvents('app_opened', since)} />
          <Stat label="GPA calculations" value={countEvents('gpa_calculated', since)} />
          <Stat label="Registrations" value={countEvents('registered', since)} />
          <Stat label="Onboardings" value={countEvents('onboarding_completed', since)} />
          <Stat label="Courses created" value={countEvents('course_created', since)} />
          <Stat label="Results entered" value={countEvents('result_recorded', since)} />
          <Stat label="Plans generated" value={countEvents('plan_generated', since)} />
          <Stat label="Sessions completed" value={countEvents('session_completed', since)} />
          <Stat label="Sessions skipped" value={countEvents('session_skipped', since)} />
          <Stat label="Snapshots created" value={countEvents('snapshot_created', since)} />
          <Stat label="Active goals" value={db.goals.filter((goal) => !goal.achievedAt).length} />
          <Stat label="Scheduled sessions" value={db.sessions.filter((s) => s.status === 'SCHEDULED').length} />
        </div>
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
