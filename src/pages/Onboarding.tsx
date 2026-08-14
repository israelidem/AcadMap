/**
 * Phase 4 — Academic onboarding.
 *
 * Four short steps: profile, grading system, academic structure, review.
 * Nothing here is institution-specific: term labels and grade rules are data.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Plus, Trash2 } from 'lucide-react';
import { LogoMark } from '@/components/brand';
import { PRESET_4_RULES, PRESET_5_RULES, PRESET_GRADING_SYSTEMS } from '@shared/grading';
import { profileSchema } from '@shared/schemas';
import type { TermStructure } from '@shared/types';
import {
  completeOnboarding,
  createAcademicYear,
  createGradingSystem,
  createTerm,
  saveProfile,
} from '@/lib/actions';
import { useSession } from '@/lib/hooks';
import { Badge, Button, Card, Input, Select, useToast } from '@/components/ui';
import { cn, uid } from '@/lib/utils';

const STEPS = ['Profile', 'Grading', 'Structure', 'Review'] as const;

const DEFAULT_TERMS: Record<TermStructure, string[]> = {
  SEMESTER: ['First Semester', 'Second Semester'],
  TRIMESTER: ['Trimester 1', 'Trimester 2', 'Trimester 3'],
  QUARTER: ['Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4'],
  CUSTOM: ['Term 1'],
};

interface CustomRule {
  id: string;
  name: string;
  point: string;
}

export default function Onboarding() {
  const { user, profile } = useSession();
  const navigate = useNavigate();
  const toast = useToast();

  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const currentYear = new Date().getFullYear();
  const [fields, setFields] = useState({
    fullName: profile?.fullName ?? '',
    institution: profile?.institution ?? '',
    faculty: profile?.faculty ?? '',
    department: profile?.department ?? '',
    programme: profile?.programme ?? '',
    level: profile?.level ?? '100 Level',
    expectedGraduationYear: String(profile?.expectedGraduationYear ?? currentYear + 4),
  });

  const [gradingChoice, setGradingChoice] = useState<string>('preset-5');
  const [customName, setCustomName] = useState('My grading system');
  const [customScale, setCustomScale] = useState('5');
  const [customRules, setCustomRules] = useState<CustomRule[]>(() =>
    PRESET_5_RULES.map((rule) => ({ id: uid('gr'), name: rule.name, point: String(rule.point) })),
  );

  const [structure, setStructure] = useState<TermStructure>('SEMESTER');
  const [yearLabel, setYearLabel] = useState(`${currentYear}/${currentYear + 1}`);
  const [termLabels, setTermLabels] = useState<string[]>(DEFAULT_TERMS.SEMESTER);
  const [currentTermIndex, setCurrentTermIndex] = useState(0);

  const presetLabel = useMemo(() => {
    if (gradingChoice === 'custom') return `${customName} (custom)`;
    const preset = PRESET_GRADING_SYSTEMS.find((system) => system.id === gradingChoice);
    return preset ? preset.name : 'Not selected';
  }, [gradingChoice, customName, customScale]);

  if (!user) return null;

  const set = (field: keyof typeof fields) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setFields((current) => ({ ...current, [field]: event.target.value }));

  const changeStructure = (next: TermStructure) => {
    setStructure(next);
    setTermLabels(DEFAULT_TERMS[next]);
    setCurrentTermIndex(0);
  };

  const validateProfile = (): boolean => {
    const parsed = profileSchema.safeParse({
      ...fields,
      expectedGraduationYear: Number(fields.expectedGraduationYear) || null,
      termStructure: structure,
      gradingSystemId: null,
    });
    if (parsed.success) {
      setErrors({});
      return true;
    }
    const next: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'form');
      next[key] ??= issue.message;
    }
    setErrors(next);
    return false;
  };

  const validateStructure = (): boolean => {
    const labels = termLabels.map((label) => label.trim()).filter(Boolean);
    if (yearLabel.trim().length < 4) {
      setErrors({ yearLabel: 'Give the academic year a label, e.g. 2026/2027.' });
      return false;
    }
    if (labels.length === 0) {
      setErrors({ terms: 'Add at least one term.' });
      return false;
    }
    setErrors({});
    return true;
  };

  const next = () => {
    if (step === 0 && !validateProfile()) return;
    if (step === 2 && !validateStructure()) return;
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  };

  const finish = () => {
    // Grading system
    let gradingSystemId: string;
    if (gradingChoice === 'custom') {
      const rules = customRules
        .filter((rule) => rule.name.trim().length > 0)
        .map((rule) => ({
          name: rule.name.trim(),
          point: Number(rule.point) || 0,
          minScore: null,
        }));
      if (rules.length === 0) {
        setStep(1);
        setErrors({ rules: 'Define at least one grade.' });
        return;
      }
      const created = createGradingSystem(
        user.id,
        customName.trim() || 'Custom',
        Number(customScale) || Math.max(...rules.map((rule) => rule.point)),
        rules,
      );
      gradingSystemId = created.id;
    } else {
      gradingSystemId = gradingChoice;
    }

    saveProfile(user.id, {
      ...fields,
      expectedGraduationYear: Number(fields.expectedGraduationYear) || null,
      termStructure: structure,
      gradingSystemId,
    });

    const year = createAcademicYear(user.id, yearLabel.trim(), Number(yearLabel.slice(0, 4)) || currentYear);
    termLabels
      .map((label) => label.trim())
      .filter(Boolean)
      .forEach((label, index) => {
        createTerm(user.id, year.id, label, index + 1, { makeCurrent: index === currentTermIndex });
      });

    completeOnboarding(user.id);
    toast('Academic setup complete.');
    navigate('/app', { replace: true });
  };

  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3 font-semibold">
          <LogoMark />

          Academic setup
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        <ol className="mb-5 flex flex-wrap gap-2 text-sm">
          {STEPS.map((label, index) => (
            <li
              key={label}
              className={cn(
                'rounded-full px-3 py-1',
                index === step
                  ? 'bg-brand text-brand-fg'
                  : index < step
                    ? 'bg-brand-soft text-brand'
                    : 'bg-surface-2 text-muted',
              )}
            >
              {index + 1}. {label}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <Card title="About you" description="This is used to label your record and snapshots.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Full name" value={fields.fullName} onChange={set('fullName')} error={errors.fullName} />
              <Input
                label="Institution"
                placeholder="e.g. University of Lagos"
                value={fields.institution}
                onChange={set('institution')}
                error={errors.institution}
              />
              <Input label="Faculty" value={fields.faculty} onChange={set('faculty')} error={errors.faculty} />
              <Input
                label="Department"
                value={fields.department}
                onChange={set('department')}
                error={errors.department}
              />
              <Input
                label="Programme"
                placeholder="e.g. LL.B Law"
                value={fields.programme}
                onChange={set('programme')}
                error={errors.programme}
              />
              <Input
                label="Current level"
                placeholder="e.g. 300 Level"
                value={fields.level}
                onChange={set('level')}
                error={errors.level}
              />
              <Input
                label="Expected graduation year"
                type="number"
                min={currentYear - 10}
                max={currentYear + 15}
                value={fields.expectedGraduationYear}
                onChange={set('expectedGraduationYear')}
                error={errors.expectedGraduationYear}
              />
            </div>
          </Card>
        )}

        {step === 1 && (
          <Card
            title="Grading system"
            description="Choose a preset or define your own grades and points."
          >
            <Select
              label="Grading system"
              value={gradingChoice}
              onChange={(event) => {
                const value = event.target.value;
                setGradingChoice(value);
                if (value === 'custom') {
                  setCustomRules(
                    PRESET_4_RULES.map((rule) => ({
                      id: uid('gr'),
                      name: rule.name,
                      point: String(rule.point),
                    })),
                  );
                  setCustomScale('4');
                }
              }}
            >
              {PRESET_GRADING_SYSTEMS.map((system) => (
                <option key={system.id} value={system.id}>
                  {system.name}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </Select>

            {gradingChoice !== 'custom' && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {PRESET_GRADING_SYSTEMS.find((system) => system.id === gradingChoice)?.rules.map(
                  (rule) => (
                    <Badge key={rule.id}>
                      {rule.name} = {rule.point}
                    </Badge>
                  ),
                )}
              </div>
            )}

            {gradingChoice === 'custom' && (
              <div className="mt-4 grid gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Name"
                    value={customName}
                    onChange={(event) => setCustomName(event.target.value)}
                  />
                  <Input
                    label="Maximum grade point"
                    type="number"
                    min={1}
                    step="0.01"
                    value={customScale}
                    onChange={(event) => setCustomScale(event.target.value)}
                  />
                </div>
                {customRules.map((rule) => (
                  <div key={rule.id} className="flex items-end gap-2">
                    <Input
                      label="Grade"
                      className="w-full"
                      value={rule.name}
                      onChange={(event) =>
                        setCustomRules((current) =>
                          current.map((item) =>
                            item.id === rule.id ? { ...item, name: event.target.value } : item,
                          ),
                        )
                      }
                    />
                    <Input
                      label="Point"
                      type="number"
                      step="0.01"
                      min={0}
                      value={rule.point}
                      onChange={(event) =>
                        setCustomRules((current) =>
                          current.map((item) =>
                            item.id === rule.id ? { ...item, point: event.target.value } : item,
                          ),
                        )
                      }
                    />
                    <button
                      type="button"
                      aria-label="Remove grade"
                      className="am-touch grid place-items-center rounded-xl text-muted hover:bg-surface-2"
                      onClick={() =>
                        setCustomRules((current) => current.filter((item) => item.id !== rule.id))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {errors.rules && <p className="am-error">{errors.rules}</p>}
                <Button
                  variant="secondary"
                  size="sm"
                  className="justify-self-start"
                  icon={<Plus className="h-4 w-4" />}
                  onClick={() =>
                    setCustomRules((current) => [...current, { id: uid('gr'), name: '', point: '' }])
                  }
                >
                  Add grade
                </Button>
              </div>
            )}
          </Card>
        )}

        {step === 2 && (
          <Card
            title="Academic structure"
            description="Terms are yours to define — semesters, trimesters, quarters or anything else."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Term structure"
                value={structure}
                onChange={(event) => changeStructure(event.target.value as TermStructure)}
              >
                <option value="SEMESTER">Semesters</option>
                <option value="TRIMESTER">Trimesters</option>
                <option value="QUARTER">Quarters</option>
                <option value="CUSTOM">Custom</option>
              </Select>
              <Input
                label="Academic year"
                placeholder="2026/2027"
                value={yearLabel}
                onChange={(event) => setYearLabel(event.target.value)}
                error={errors.yearLabel}
              />
            </div>

            <div className="mt-4 grid gap-2">
              {termLabels.map((label, index) => (
                <div key={index} className="flex items-end gap-2">
                  <Input
                    label={index === 0 ? 'Terms' : undefined}
                    className="w-full"
                    value={label}
                    onChange={(event) =>
                      setTermLabels((current) =>
                        current.map((item, position) => (position === index ? event.target.value : item)),
                      )
                    }
                  />
                  <Button
                    variant={currentTermIndex === index ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => setCurrentTermIndex(index)}
                  >
                    {currentTermIndex === index ? 'Current' : 'Set current'}
                  </Button>
                  <button
                    type="button"
                    aria-label="Remove term"
                    className="am-touch grid place-items-center rounded-xl text-muted hover:bg-surface-2"
                    onClick={() =>
                      setTermLabels((current) =>
                        current.length === 1 ? current : current.filter((_, position) => position !== index),
                      )
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {errors.terms && <p className="am-error">{errors.terms}</p>}
              <Button
                variant="secondary"
                size="sm"
                className="justify-self-start"
                icon={<Plus className="h-4 w-4" />}
                onClick={() => setTermLabels((current) => [...current, `Term ${current.length + 1}`])}
              >
                Add term
              </Button>
            </div>
          </Card>
        )}

        {step === 3 && (
          <Card title="Review" description="You can change any of this later in your profile.">
            <dl className="grid gap-3 sm:grid-cols-2">
              {[
                ['Name', fields.fullName],
                ['Institution', fields.institution],
                ['Faculty', fields.faculty],
                ['Department', fields.department],
                ['Programme', fields.programme],
                ['Level', fields.level],
                ['Expected graduation', fields.expectedGraduationYear],
                ['Grading system', presetLabel],
                ['Academic year', yearLabel],
                ['Terms', termLabels.filter(Boolean).join(', ')],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-surface-2 px-4 py-3">
                  <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
                  <dd className="mt-0.5 text-sm">{value || '—'}</dd>
                </div>
              ))}
            </dl>
          </Card>
        )}

        <div className="mt-5 flex justify-between gap-2">
          <Button
            variant="secondary"
            onClick={() => setStep((current) => Math.max(0, current - 1))}
            disabled={step === 0}
            icon={<ArrowLeft className="h-4 w-4" />}
          >
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={next} icon={<ArrowRight className="h-4 w-4" />}>
              Continue
            </Button>
          ) : (
            <Button onClick={finish} icon={<Check className="h-4 w-4" />}>
              Finish setup
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
