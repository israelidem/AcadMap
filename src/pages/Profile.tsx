/**
 * Profile & settings — identity, grading, sharing and preferences.
 *
 * Sharing is deliberately opt-in per field: the student picks exactly what a
 * snapshot exposes, and can revoke it at any time.
 */

import { useState } from 'react';
import { Copy, LogOut, Trash2 } from 'lucide-react';
import type { ShareField } from '@shared/types';
import { round } from '@shared/gpa';
import { deleteAccount, logout } from '@/lib/auth';

import {
  createSnapshot,
  deleteSnapshot,
  revokeSnapshot,
  saveProfile,
  savePreferences,
} from '@/lib/actions';
import { useAcademicMetrics, usePlannerMetrics, useSession, useUserData } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
import { Tabs } from '@/components/tabs';
import {
  Badge,
  Button,
  Card,
  Input,
  Modal,
  PageHeader,
  Select,
  Toggle,
  useToast,
} from '@/components/ui';


const SHARE_FIELDS: { field: ShareField; label: string }[] = [
  { field: 'fullName', label: 'Name' },
  { field: 'institution', label: 'Institution' },
  { field: 'programme', label: 'Programme' },
  { field: 'level', label: 'Level' },
  { field: 'cgpa', label: 'CGPA' },
  { field: 'termGpa', label: 'Current term GPA' },
  { field: 'completedUnits', label: 'Completed units' },
  { field: 'streak', label: 'Study streak' },
];

export default function Profile() {
  const { user, profile, preferences } = useSession();
  const toast = useToast();
  const { mode, setMode } = useTheme();
  const metrics = useAcademicMetrics();
  const planner = usePlannerMetrics();
  const { snapshots } = useUserData(user?.id ?? null);

  const [tab, setTab] = useState('profile');
  const [fields, setFields] = useState({
    fullName: profile?.fullName ?? '',
    institution: profile?.institution ?? '',
    faculty: profile?.faculty ?? '',
    department: profile?.department ?? '',
    programme: profile?.programme ?? '',
    level: profile?.level ?? '',
    expectedGraduationYear: String(profile?.expectedGraduationYear ?? new Date().getFullYear() + 4),
  });
  const [selected, setSelected] = useState<ShareField[]>(['fullName', 'programme', 'cgpa', 'level']);
  const [expiryDays, setExpiryDays] = useState('7');

  /* Deleting the account: password-confirmed, in a modal, never one click. */
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState<string>();
  const [deleting, setDeleting] = useState(false);

  if (!user) return null;

  const confirmDelete = async () => {
    setDeleteError(undefined);
    if (!deletePassword) {
      setDeleteError('Enter your password to confirm.');
      return;
    }

    setDeleting(true);
    const result = await deleteAccount(deletePassword);
    setDeleting(false);

    if (!result.ok) {
      setDeleteError(result.error ?? 'Could not delete the account.');
      return;
    }

    // The session is gone, so the router sends this device back to the landing
    // page on the next render; the toast is the only confirmation needed.
    setDeleteOpen(false);
    setDeletePassword('');
    toast('Your account and all its data have been deleted.');
  };


  const set = (key: keyof typeof fields) => (event: { target: { value: string } }) =>
    setFields((current) => ({ ...current, [key]: event.target.value }));

  const snapshotValue = (field: ShareField): string | number => {
    switch (field) {
      case 'fullName':
        return fields.fullName;
      case 'institution':
        return fields.institution;
      case 'programme':
        return fields.programme;
      case 'level':
        return fields.level;
      case 'cgpa':
        return `${metrics.cgpa.toFixed(2)} / ${round(metrics.scale, 2)}`;
      case 'termGpa':
        return metrics.termGpa.toFixed(2);
      case 'completedUnits':
        return metrics.completedUnits;
      case 'streak':
        return `${planner.streak.current} days`;
    }
  };

  return (
    <>
      <PageHeader
        title="Profile & settings"
        description={user.email}
        action={
          <Button
            size="sm"
            variant="secondary"
            icon={<LogOut className="h-4 w-4" />}
            onClick={() => logout()}
          >
            Log out
          </Button>
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'profile', label: 'Academic profile' },
          { value: 'sharing', label: 'Sharing' },
          { value: 'preferences', label: 'Preferences' },
        ]}
      />

      {tab === 'profile' && (
        <Card title="Academic profile" description="Used across your dashboard and snapshots.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Full name" value={fields.fullName} onChange={set('fullName')} />
            <Input label="Institution" value={fields.institution} onChange={set('institution')} />
            <Input label="Faculty" value={fields.faculty} onChange={set('faculty')} />
            <Input label="Department" value={fields.department} onChange={set('department')} />
            <Input label="Programme" value={fields.programme} onChange={set('programme')} />
            <Input label="Current level" value={fields.level} onChange={set('level')} />
            <Input
              label="Expected graduation year"
              type="number"
              value={fields.expectedGraduationYear}
              onChange={set('expectedGraduationYear')}
            />
          </div>
          <div className="mt-4">
            <Button
              onClick={() => {
                saveProfile(user.id, {
                  ...fields,
                  expectedGraduationYear: Number(fields.expectedGraduationYear) || null,
                });
                toast('Profile saved.');
              }}
            >
              Save changes
            </Button>
          </div>
        </Card>
      )}

      {tab === 'sharing' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card
            title="Create a snapshot"
            description="Pick exactly what the link shows. Nothing else is exposed."
          >
            <div className="grid gap-2">
              {SHARE_FIELDS.map(({ field, label }) => (
                <Toggle
                  key={field}
                  label={`${label} — ${snapshotValue(field)}`}
                  checked={selected.includes(field)}
                  onChange={(checked) =>
                    setSelected((current) =>
                      checked ? [...current, field] : current.filter((item) => item !== field),
                    )
                  }
                />
              ))}
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Select
                label="Expires after"
                value={expiryDays}
                onChange={(event) => setExpiryDays(event.target.value)}
              >
                <option value="1">1 day</option>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="0">Never</option>
              </Select>
            </div>
            <div className="mt-4">
              <Button
                onClick={() => {
                  if (selected.length === 0) {
                    toast('Select at least one field.', 'error');
                    return;
                  }
                  const payload: Record<string, string | number> = {};
                  selected.forEach((field) => {
                    payload[field] = snapshotValue(field);
                  });
                  const snapshot = createSnapshot(
                    user.id,
                    selected,
                    payload,
                    Number(expiryDays) || null,
                  );
                  toast('Snapshot created.');
                  void navigator.clipboard
                    ?.writeText(`${window.location.origin}/share/${snapshot.token}`)
                    .catch(() => undefined);
                }}
              >
                Generate snapshot link
              </Button>
            </div>
          </Card>

          <Card title="Your snapshots" description="Revoke or delete at any time.">
            {snapshots.length === 0 ? (
              <p className="text-sm text-muted">No snapshots yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {snapshots.map((snapshot) => {
                  const url = `${window.location.origin}/share/${snapshot.token}`;
                  const expired =
                    snapshot.expiresAt !== null && snapshot.expiresAt < new Date().toISOString();
                  return (
                    <li key={snapshot.id} className="flex flex-wrap items-center gap-2 py-3 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">/share/{snapshot.token}</p>
                        <p className="text-muted">
                          {snapshot.fields.length} field(s) · {snapshot.views} view(s) ·{' '}
                          {snapshot.expiresAt
                            ? `expires ${snapshot.expiresAt.slice(0, 10)}`
                            : 'no expiry'}
                        </p>
                      </div>
                      <Badge
                        tone={snapshot.revokedAt ? 'danger' : expired ? 'warning' : 'success'}
                      >
                        {snapshot.revokedAt ? 'Revoked' : expired ? 'Expired' : 'Active'}
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Copy className="h-4 w-4" />}
                        onClick={() => {
                          void navigator.clipboard?.writeText(url).catch(() => undefined);
                          toast('Link copied.');
                        }}
                      >
                        Copy
                      </Button>
                      {!snapshot.revokedAt && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => revokeSnapshot(user.id, snapshot.id)}
                        >
                          Revoke
                        </Button>
                      )}
                      <button
                        type="button"
                        aria-label="Delete snapshot"
                        className="text-danger"
                        onClick={() => deleteSnapshot(user.id, snapshot.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === 'preferences' && (
        <Card title="Preferences" description="Theme, reminders and planner defaults.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Theme"
              value={mode}
              onChange={(event) => {
                const value = event.target.value as 'light' | 'dark' | 'system';
                setMode(value);
                savePreferences(user.id, { theme: value });
              }}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </Select>
            <Input
              label="Reminder lead time (minutes)"
              type="number"
              min={0}
              max={240}
              value={String(preferences.reminderLeadMinutes)}
              onChange={(event) =>
                savePreferences(user.id, {
                  reminderLeadMinutes: Math.max(0, Number(event.target.value) || 0),
                })
              }
            />
            <Input
              label="Default session length (minutes)"
              type="number"
              min={30}
              max={180}
              step={15}
              value={String(preferences.defaultSessionMinutes)}
              onChange={(event) =>
                savePreferences(user.id, {
                  defaultSessionMinutes: Math.min(
                    180,
                    Math.max(30, Number(event.target.value) || 60),
                  ),
                })
              }
            />
          </div>
          <div className="mt-4">
            <Toggle
              label="Browser and in-app notifications"
              checked={preferences.notificationsEnabled}
              onChange={(checked) => savePreferences(user.id, { notificationsEnabled: checked })}
            />
          </div>
        </Card>
      )}

      {tab === 'preferences' && (
        <Card
          className="mt-4 border-danger/40"
          title="Delete my account"
          description="Removes the account and every course, result, plan and snapshot in it, on all your devices. This cannot be undone."
        >
          <Button
            variant="danger"
            icon={<Trash2 className="h-4 w-4" />}
            onClick={() => {
              setDeleteError(undefined);
              setDeletePassword('');
              setDeleteOpen(true);
            }}
          >
            Delete my account
          </Button>
        </Card>
      )}

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete your account?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              Keep my account
            </Button>
            <Button variant="danger" loading={deleting} onClick={() => void confirmDelete()}>
              Delete permanently
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <p className="text-sm text-muted">
            Everything under <span className="font-medium">{user.email}</span> is deleted
            immediately: courses, results, GPA history, study plans, goals and share links. There is
            no recovery, and no export is kept.
          </p>
          {/* The server insists on the password; asking here is not decoration. */}
          <Input
            label="Confirm your password"
            type="password"
            autoComplete="current-password"
            value={deletePassword}
            onChange={(event) => setDeletePassword(event.target.value)}
            error={deleteError}
          />
        </div>
      </Modal>
    </>
  );
}


