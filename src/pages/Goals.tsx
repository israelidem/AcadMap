/**
 * Goals — academic and study targets with live progress.
 *
 * Progress is derived from existing data (results, sessions, streak) so a goal
 * never needs manual updating.
 */

import { useState } from 'react';
import { Plus, Target, Trash2 } from 'lucide-react';
import type { GoalType } from '@shared/types';
import { round } from '@shared/gpa';
import { createGoal, deleteGoal, setGoalAchieved } from '@/lib/actions';
import { useAcademicMetrics, usePlannerMetrics, useSession, useUserData } from '@/lib/hooks';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Progress,
  Select,
  useToast,
} from '@/components/ui';

const GOAL_LABELS: Record<GoalType, string> = {
  TARGET_CGPA: 'Target CGPA',
  TARGET_GPA: 'Target term GPA',
  SESSIONS: 'Completed study sessions',
  STREAK: 'Study streak (days)',
};

export default function Goals() {
  const { user } = useSession();
  const toast = useToast();
  const metrics = useAcademicMetrics();
  const planner = usePlannerMetrics();
  const { goals, terms } = useUserData(user?.id ?? null);

  const [open, setOpen] = useState(false);
  const [type, setType] = useState<GoalType>('TARGET_CGPA');
  const [title, setTitle] = useState('');
  const [targetValue, setTargetValue] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [termId, setTermId] = useState('');

  if (!user) return null;

  const completedSessions = planner.stats.completed;

  const currentValue = (goalType: GoalType): number => {
    switch (goalType) {
      case 'TARGET_CGPA':
        return metrics.cgpa;
      case 'TARGET_GPA':
        return metrics.termGpa;
      case 'SESSIONS':
        return completedSessions;
      case 'STREAK':
        return planner.streak.current;
    }
  };

  return (
    <>
      <PageHeader
        title="Goals"
        description="Targets you can actually measure — progress updates itself."
        action={
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
            New goal
          </Button>
        }
      />

      {goals.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Target className="h-6 w-6" />}
            title="No goals yet"
            description="Set a target CGPA, a study-session target or a streak goal."
            action={<Button onClick={() => setOpen(true)}>Create your first goal</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {goals.map((goal) => {
            const current = currentValue(goal.type);
            const percent = goal.targetValue > 0 ? (current / goal.targetValue) * 100 : 0;
            const met = current >= goal.targetValue;
            return (
              <Card key={goal.id}>
                <div className="mb-2 flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{goal.title}</p>
                    <p className="text-sm text-muted">
                      {GOAL_LABELS[goal.type]} · target {round(goal.targetValue, 2)}
                      {goal.dueDate ? ` · by ${goal.dueDate}` : ''}
                    </p>
                  </div>
                  <Badge tone={goal.achievedAt || met ? 'success' : 'neutral'}>
                    {goal.achievedAt || met ? 'On target' : 'In progress'}
                  </Badge>
                  <button
                    type="button"
                    aria-label="Delete goal"
                    className="text-danger"
                    onClick={() => deleteGoal(user.id, goal.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <Progress
                  value={Math.min(100, percent)}
                  label={`${round(current, 2)} of ${round(goal.targetValue, 2)}`}
                />
                <div className="mt-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setGoalAchieved(user.id, goal.id, !goal.achievedAt)}
                  >
                    {goal.achievedAt ? 'Reopen goal' : 'Mark achieved'}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New goal"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const value = Number(targetValue);
                if (!Number.isFinite(value) || value <= 0) {
                  toast('Enter a target greater than zero.', 'error');
                  return;
                }
                createGoal(user.id, {
                  type,
                  title: title.trim() || GOAL_LABELS[type],
                  targetValue: value,
                  termId: termId || null,
                  dueDate: dueDate || null,
                });
                setTitle('');
                setTargetValue('');
                setOpen(false);
                toast('Goal created.');
              }}
            >
              Create goal
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Select
            label="Goal type"
            value={type}
            onChange={(event) => setType(event.target.value as GoalType)}
          >
            {(Object.keys(GOAL_LABELS) as GoalType[]).map((goalType) => (
              <option key={goalType} value={goalType}>
                {GOAL_LABELS[goalType]}
              </option>
            ))}
          </Select>
          <Input
            label="Title"
            placeholder={GOAL_LABELS[type]}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="Target value"
              type="number"
              step="0.01"
              min={0}
              value={targetValue}
              onChange={(event) => setTargetValue(event.target.value)}
            />
            <Input
              label="Due date"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
            <Select label="Term" value={termId} onChange={(event) => setTermId(event.target.value)}>
              <option value="">Any term</option>
              {terms.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Modal>
    </>
  );
}
