/**
 * Authenticated app shell: registry masthead, desktop nav, mobile bottom nav.
 *
 * The masthead is two rules deep, the way the head of a printed record is: the
 * name and the controls on the first line, the sections filed along the second.
 * There is no left sidebar on purpose — this is a document a student reads, not
 * a console they administer.
 */

import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquarePlus,
  Moon,
  Shield,
  Sun,
  Target,
  User as UserIcon,
} from 'lucide-react';
import { useSession } from '@/lib/hooks';
import { logout } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { cn, initials } from '@/lib/utils';
import { Badge, Button, Modal } from './ui';
import { Wordmark } from './brand';

import { NotificationBell } from './notifications';
import { SyncStatus } from './syncStatus';
import { FeedbackForm } from './feedback';

const PRIMARY = [
  { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/app/planner', label: 'Planner', icon: CalendarDays },
  { to: '/app/courses', label: 'Courses', icon: BookOpen },
  { to: '/app/record', label: 'Academic Record', icon: GraduationCap },
  { to: '/app/performance', label: 'Performance', icon: BarChart3 },
  { to: '/app/goals', label: 'Goals', icon: Target },
  { to: '/app/profile', label: 'Profile', icon: UserIcon },
];

const MOBILE = [
  { to: '/app', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/app/planner', label: 'Planner', icon: CalendarDays },
  { to: '/app/courses', label: 'Courses', icon: BookOpen },
  { to: '/app/performance', label: 'Trend', icon: BarChart3 },
];

function ThemeToggle() {
  const { mode, setMode } = useTheme();
  const next = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
  return (
    <button
      type="button"
      onClick={() => setMode(next)}
      aria-label={`Theme: ${mode}. Switch to ${next}`}
      title={`Theme: ${mode}`}
      className="am-touch grid place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
    >
      {mode === 'dark' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
    </button>
  );
}

export function AppLayout() {
  const { user, profile, isOwner } = useSession();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const name = profile?.fullName || user?.email || 'Student';

  return (
    <div className="min-h-dvh overflow-x-hidden bg-bg">
      <header className="sticky top-0 z-40 border-b border-border bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          {/*
            shrink-0 and nowrap, or the name loses. The icon row to the right was
            allowed to take what it liked, so on a narrow phone the wordmark was
            squeezed into a column of single letters.
          */}
          <Link to="/app" className="shrink-0 rounded-md" aria-label="AcadMap dashboard">
            <Wordmark />
          </Link>

          {/* The student's filing details, printed beside the name as on a record. */}
          {profile?.institution && (
            <p className="hidden min-w-0 truncate border-l border-rule pl-3 font-mono text-micro uppercase text-muted xl:block">
              {profile.institution}
              {profile.level ? ` · ${profile.level}` : ''}
            </p>
          )}

          {/* min-w-0 so this row yields space rather than pushing the name out. */}
          <div className="ml-auto flex min-w-0 items-center gap-1">
            {/* Feedback and admin live in the menu on a phone: what stays in the
                header is what a student reaches for mid-task. */}
            <button
              type="button"
              onClick={() => setFeedbackOpen(true)}
              aria-label="Send feedback"
              className="am-touch hidden place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg lg:grid"
            >
              <MessageSquarePlus className="h-5 w-5" />
            </button>
            <NotificationBell />
            <SyncStatus />
            <ThemeToggle />

            {isOwner && (
              <Link
                to="/admin"
                className="am-touch hidden place-items-center rounded-lg text-brand hover:bg-brand-soft lg:grid"
                aria-label="Admin dashboard"
                title="Admin dashboard"
              >
                <Shield className="h-5 w-5" />
              </Link>
            )}
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="am-touch grid place-items-center rounded-lg lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div
              className="ml-1 hidden h-9 w-9 place-items-center overflow-hidden rounded-md border border-brand/40 bg-brand-soft font-mono text-micro font-semibold text-brand lg:grid"
              title={name}
            >
              {profile?.avatarDataUrl ? (
                <img src={profile.avatarDataUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                initials(name)
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="hidden lg:inline-flex"
              onClick={() => {
                logout();
                navigate('/');
              }}
              icon={<LogOut className="h-4 w-4" />}
            >
              Log out
            </Button>
          </div>
        </div>

        {/* Second rule: the sections, filed along the foot of the masthead. */}
        <nav className="hidden border-t border-rule lg:block">
          <div className="mx-auto flex max-w-6xl items-stretch gap-6 px-4">
            {PRIMARY.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'relative -mb-px py-2.5 font-mono text-micro font-medium uppercase transition-colors',
                    'after:absolute after:inset-x-0 after:-bottom-px after:h-[2px] after:content-[""]',
                    isActive
                      ? 'text-brand after:bg-brand'
                      : 'text-muted after:bg-transparent hover:text-fg hover:after:bg-border',
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-28 pt-6 lg:pb-12">
        <Outlet />
      </main>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {MOBILE.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  // The active section is marked at the top edge, so the label
                  // does not have to rely on colour alone.
                  'am-touch relative flex flex-col items-center justify-center gap-1 py-2 font-mono text-[10px] uppercase tracking-[0.06em]',
                  'before:absolute before:inset-x-3 before:top-0 before:h-[2px] before:content-[""]',
                  isActive ? 'text-brand before:bg-brand' : 'text-muted before:bg-transparent',
                )
              }
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="am-touch flex flex-col items-center justify-center gap-1 py-2 font-mono text-[10px] uppercase tracking-[0.06em] text-muted"
          >
            <Menu className="h-5 w-5" />
            More
          </button>
        </div>
      </nav>

      <Modal open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu">
        <div className="grid gap-1">
          {PRIMARY.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                cn(
                  'am-touch flex items-center gap-3 rounded-lg px-3 text-sm',
                  isActive
                    ? 'border border-brand/40 bg-brand-soft font-medium text-brand'
                    : 'border border-transparent hover:bg-surface-2',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
          {isOwner && (
            <NavLink
              to="/admin"
              onClick={() => setMenuOpen(false)}
              className="am-touch flex items-center gap-3 rounded-lg px-3 text-sm hover:bg-surface-2"
            >
              <Shield className="h-4 w-4" />
              Admin dashboard
              <Badge tone="brand">Owner</Badge>
            </NavLink>
          )}
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setFeedbackOpen(true);
            }}
            className="am-touch flex items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-surface-2"
          >
            <MessageSquarePlus className="h-4 w-4" />
            Send feedback
          </button>

          <button
            type="button"
            onClick={() => {
              logout();
              navigate('/');
            }}
            className="am-touch mt-1 flex items-center gap-3 rounded-lg border-t border-rule px-3 text-left text-sm text-danger hover:bg-surface-2"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      </Modal>

      <Modal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} title="Send feedback">
        <FeedbackForm onDone={() => setFeedbackOpen(false)} />
      </Modal>
    </div>
  );
}
