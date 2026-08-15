/** Public landing page — eager-loaded, no API calls. */

import { Link } from 'react-router-dom';
import { Calculator as CalculatorIcon } from 'lucide-react';
import { Button } from '@/components/ui';
import { Wordmark } from '@/components/brand';
import { RecordPlate, UnitLedger, type LedgerEntry } from '@/components/ledger';
import { useTheme } from '@/lib/theme';

/*
 * A worked example, not a screenshot.
 *
 * The hero shows the product's one original idea — that a CGPA is a
 * unit-weighted average, and the weighting is where the story is. These six
 * courses carry 87 quality points across 21 units, so they average 4.14 on a
 * 5.0 scale: the two-unit A is doing less for the student than the six-unit C is
 * doing against them, and the ledger makes that visible before anyone signs up.

 */
const SAMPLE: LedgerEntry[] = [
  { code: 'LAW 301', name: 'Law of Evidence', units: 6, gradePoint: 3, gradeName: 'C' },
  { code: 'LAW 302', name: 'Company Law', units: 4, gradePoint: 5, gradeName: 'A' },
  { code: 'LAW 303', name: 'Equity & Trusts', units: 4, gradePoint: 4, gradeName: 'B' },
  { code: 'LAW 304', name: 'Land Law', units: 3, gradePoint: 5, gradeName: 'A' },
  { code: 'GST 301', name: 'Research Methods', units: 2, gradePoint: 5, gradeName: 'A' },
  { code: 'LAW 305', name: 'Jurisprudence', units: 2, gradePoint: 4, gradeName: 'B' },
];

/* What the product does, in the student's words, one row per answer. */
const CAPABILITIES = [
  {
    question: 'Where do I stand?',
    answer: 'GPA and CGPA on your school\u2019s scale',
    detail:
      '4.0, 5.0 or a scale you define. Semesters, trimesters or your own terms — nothing is hard-coded.',
  },
  {
    question: 'What do I study today?',
    answer: 'A plan built from your own week',
    detail:
      'Give AcadMap your courses, topics, exam dates and free hours. It schedules around deadlines and priority, and reschedules when you miss a session.',
  },
  {
    question: 'Am I improving?',
    answer: 'Term-by-term trend, unit-weighted',
    detail:
      'GPA history against cumulative CGPA, and projections that weight by units instead of averaging averages.',
  },
  {
    question: 'Can I still reach a 4.5?',
    answer: 'The average you need, or a plain no',
    detail:
      'The target calculator works out the GPA required across your remaining units — and says when a target is mathematically out of reach.',
  },
  {
    question: 'Is my streak real?',
    answer: 'Sessions completed, not app opens',
    detail: 'A streak only grows when you finish a study session you planned.',
  },
  {
    question: 'Can my parents see this?',
    answer: 'A snapshot you can revoke',
    detail:
      'Share only the figures you pick, at a link that expires. Revoke it and the link is dead immediately.',
  },
];

const SETUP = [
  'Create your academic profile and grading system.',
  'Add academic years, terms and courses.',
  'Record results — GPA and CGPA update themselves.',
  'Set your free hours and generate a study plan.',
];

export default function Landing() {
  const { mode, setMode } = useTheme();

  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3.5">
          <Wordmark />
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="am-touch rounded-lg px-3 font-mono text-micro uppercase text-muted hover:bg-surface-2 hover:text-fg"
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
        </div>
      </header>

      {/* ---------------------------------- Hero --------------------------------- */}
      <section className="mx-auto max-w-6xl px-4 pb-12 pt-10 sm:pt-14">
        <p className="am-eyebrow">Academic record · Study plan · Projections</p>
        <h1 className="mt-3 max-w-[46rem] text-[2.1rem] leading-[1.05] sm:text-[3.25rem]">
          Your CGPA is a weighted average. AcadMap shows you the weights.
        </h1>
        <p className="mt-5 max-w-2xl text-base text-muted sm:text-lg">
          Keep your results, courses, deadlines and study schedule in one record — so the figure on
          your transcript, the work in front of you and the plan for today all agree with each other.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/register">
            <Button size="lg">Create a free account</Button>
          </Link>
          <Link to="/calculator">
            <Button size="lg" variant="secondary" icon={<CalculatorIcon className="h-4 w-4" />}>
              Calculate GPA — no account
            </Button>
          </Link>
        </div>

        {/* The signature: a real record, drawn. */}
        <div className="am-card mt-10 overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule bg-surface-2/60 px-4 py-3 sm:px-5">
            <h2 className="am-tab-label text-sm font-semibold uppercase tracking-[0.06em]">
              Unit ledger — a worked example
            </h2>
            <p className="font-mono text-micro uppercase text-muted">Law · Level 300 · 21 units</p>
          </div>
          <div className="grid gap-0 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
            <div className="border-b border-rule p-4 sm:p-5 lg:border-b-0 lg:border-r">
              <RecordPlate label="CGPA" value="4.14" outOf="5" note="21 units · 87 quality points" />
              <p className="mt-4 text-sm text-muted">
                Three A grades, and the average still sits at 4.14 — because the single C is worth
                six units. That is the arithmetic a plain number hides.
              </p>
            </div>
            <div className="p-4 sm:p-5">
              <UnitLedger entries={SAMPLE} scale={5} average={4.14} />

            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------ Capabilities ----------------------------- */}
      <section className="mx-auto max-w-6xl px-4 pb-14">
        <h2 className="am-eyebrow">What a student asks, and where AcadMap answers</h2>
        <dl className="mt-4 border-t border-border">
          {CAPABILITIES.map(({ question, answer, detail }) => (
            <div
              key={question}
              className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] sm:gap-6 sm:py-5"
            >
              <dt className="font-mono text-micro uppercase text-brand">{question}</dt>
              <dd>
                <p className="font-display text-base font-semibold sm:text-lg">{answer}</p>
                <p className="mt-1 max-w-2xl text-sm text-muted">{detail}</p>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* --------------------------------- Setup -------------------------------- */}
      <section className="mx-auto max-w-6xl px-4 pb-20">
        <div className="am-card px-5 py-6 sm:px-8 sm:py-8">
          <h2 className="text-xl">Setting up takes four passes</h2>
          <p className="mt-1.5 text-sm text-muted">
            In this order, because each step feeds the next.
          </p>
          {/* Numbered because the order is load-bearing: no plan without results. */}
          <ol className="mt-6 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            {SETUP.map((step, index) => (
              <li key={step} className="border-t-2 border-brand/70 pt-3">
                <span className="tabular block text-xs font-medium text-brand">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="mt-1.5 block text-sm">{step}</span>
              </li>
            ))}
          </ol>
          <div className="mt-7">
            <Link to="/register">
              <Button>Start with step one</Button>
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 font-mono text-micro uppercase text-muted">
          <span>© {new Date().getFullYear()} AcadMap</span>
          <div className="flex gap-5">
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
