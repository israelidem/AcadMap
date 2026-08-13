/** Public landing page — eager-loaded, no API calls. */

import { Link } from 'react-router-dom';
import {
  BarChart3,
  CalendarDays,
  Calculator as CalculatorIcon,
  Flame,
  GraduationCap,
  Share2,
  Target,
} from 'lucide-react';
import { Button } from '@/components/ui';
import { useTheme } from '@/lib/theme';

const FEATURES = [
  {
    icon: CalculatorIcon,
    title: 'GPA & CGPA that fit your school',
    body: '4.0, 5.0 or a custom scale. Semesters, trimesters or your own terms — nothing is hard-coded.',
  },
  {
    icon: CalendarDays,
    title: 'Automatic study planner',
    body: 'Give AcadMap your courses, topics, exam dates and free hours. It builds a schedule that respects deadlines and priority.',
  },
  {
    icon: BarChart3,
    title: 'Performance you can read',
    body: 'GPA history, CGPA trend and unit-weighted projections instead of guesswork.',
  },
  {
    icon: Target,
    title: 'Target calculator',
    body: 'Find the average GPA you need across remaining units — and be told plainly when a target is unreachable.',
  },
  {
    icon: Flame,
    title: 'Streaks that mean something',
    body: 'A streak comes from completing planned study sessions, not from opening the app.',
  },
  {
    icon: Share2,
    title: 'Temporary sharing',
    body: 'Share a snapshot of only the metrics you choose. Expire it or revoke it whenever you want.',
  },
];

export default function Landing() {
  const { mode, setMode } = useTheme();

  return (
    <div className="min-h-dvh bg-bg">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2 font-semibold">
          <GraduationCap className="h-6 w-6 text-brand" />
          AcadMap
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="am-touch rounded-xl px-3 text-sm text-muted hover:bg-surface-2"
            onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
          >
            {mode === 'dark' ? 'Light' : 'Dark'}
          </button>
          <Link to="/login">
            <Button variant="ghost" size="sm">
              Log in
            </Button>
          </Link>
          <Link to="/register">
            <Button size="sm">Get started</Button>
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-14 pt-8 sm:pt-16">
        <p className="text-sm font-medium text-brand">Academic planning &amp; performance</p>
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight sm:text-5xl">
          Know how you&apos;re doing. Know what to do next.
        </h1>
        <p className="mt-4 max-w-2xl text-base text-muted sm:text-lg">
          AcadMap keeps your results, courses, deadlines and study schedule in one place — so your
          GPA, your workload and your plan for today all agree with each other.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link to="/register">
            <Button size="lg">Create a free account</Button>
          </Link>
          <Link to="/calculator">
            <Button size="lg" variant="secondary" icon={<CalculatorIcon className="h-4 w-4" />}>
              Calculate GPA — no account
            </Button>
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <article key={title} className="am-card px-5 py-5">
              <Icon className="h-5 w-5 text-brand" />
              <h2 className="mt-3 text-base font-semibold">{title}</h2>
              <p className="mt-1.5 text-sm text-muted">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20">
        <div className="am-card px-5 py-6 sm:px-8 sm:py-8">
          <h2 className="text-xl font-semibold">How students set up in minutes</h2>
          <ol className="mt-4 grid gap-3 text-sm text-muted sm:grid-cols-2 lg:grid-cols-4">
            {[
              'Create your academic profile and grading system.',
              'Add academic years, terms and courses.',
              'Record results — GPA and CGPA update themselves.',
              'Set your free hours and generate a study plan.',
            ].map((step, index) => (
              <li key={step} className="am-card bg-surface-2 px-4 py-3">
                <span className="text-brand">{index + 1}.</span> {step}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted">
          <span>© {new Date().getFullYear()} AcadMap</span>
          <div className="flex gap-4">
            <Link to="/calculator" className="hover:text-fg">
              GPA calculator
            </Link>
            <Link to="/login" className="hover:text-fg">
              Log in
            </Link>
            <Link to="/register" className="hover:text-fg">
              Sign up
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
