/** Authenticated app shell: top bar, desktop nav, mobile bottom nav. */

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
import { LogoMark } from './brand';

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
  { to: '/app/performance', label: 'Performance', icon: BarChart3 },
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
      className="am-touch grid place-items-center rounded-xl text-muted hover:bg-surface-2"
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
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <Link to="/app" className="flex items-center gap-2 font-semibold">
            <LogoMark />
            <span>AcadMap</span>
          </Link>


          <nav className="ml-4 hidden flex-1 items-center gap-1 lg:flex">
            {PRIMARY.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'rounded-xl px-3 py-2 text-sm font-medium transition',
                    isActive ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-surface-2 hover:text-fg',
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setFeedbackOpen(true)}
              aria-label="Send feedback"
              className="am-touch grid place-items-center rounded-xl text-muted hover:bg-surface-2"
            >
              <MessageSquarePlus className="h-5 w-5" />
            </button>
            <NotificationBell />
            <SyncStatus />
            <ThemeToggle />

            {/*
              Shown at every width: the owner's main surface is the installed PWA
              on a phone, where the header is the only always-visible chrome.
            */}
            {isOwner && (
              <Link
                to="/admin"
                className="am-touch grid place-items-center rounded-xl text-brand hover:bg-brand-soft"
                aria-label="Admin dashboard"
                title="Admin dashboard"
              >
                <Shield className="h-5 w-5" />
              </Link>
            )}
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="am-touch grid place-items-center rounded-xl lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div
              className="ml-1 hidden h-9 w-9 place-items-center overflow-hidden rounded-full bg-brand-soft text-sm font-semibold text-brand lg:grid"
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
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-24 pt-5 lg:pb-10">
        <Outlet />
      </main>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {MOBILE.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'am-touch flex flex-col items-center justify-center gap-0.5 py-2 text-[11px]',
                  isActive ? 'text-brand' : 'text-muted',
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
            className="am-touch flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] text-muted"
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
                  'am-touch flex items-center gap-3 rounded-xl px-3 text-sm',
                  isActive ? 'bg-brand-soft text-brand' : 'hover:bg-surface-2',
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
              className="am-touch flex items-center gap-3 rounded-xl px-3 text-sm hover:bg-surface-2"
            >
              <Shield className="h-4 w-4" />
              Admin dashboard
              <Badge tone="brand">Owner</Badge>
            </NavLink>
          )}
          <button
            type="button"
            onClick={() => {
              logout();
              navigate('/');
            }}
            className="am-touch flex items-center gap-3 rounded-xl px-3 text-left text-sm text-danger hover:bg-surface-2"
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
