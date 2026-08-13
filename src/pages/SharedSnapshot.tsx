/**
 * Public snapshot view — /share/:token
 *
 * Only the fields the owner selected are rendered; the page never reads the
 * owner's academic records directly, just the frozen payload.
 */

import { useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import type { ShareField } from '@shared/types';
import { findSnapshotByToken, recordSnapshotView } from '@/lib/actions';
import { Badge, Button, Card } from '@/components/ui';

const FIELD_LABELS: Record<ShareField, string> = {
  fullName: 'Name',
  institution: 'Institution',
  programme: 'Programme',
  level: 'Level',
  cgpa: 'CGPA',
  termGpa: 'Current term GPA',
  completedUnits: 'Completed units',
  streak: 'Study streak',
};

export default function SharedSnapshot() {
  const { token = '' } = useParams();
  const lookup = useMemo(() => findSnapshotByToken(token), [token]);

  useEffect(() => {
    if (lookup.status === 'OK') recordSnapshotView(token);
  }, [lookup.status, token]);

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-lg place-items-center px-4 py-10">
      <div className="w-full">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2 font-semibold">
          <GraduationCap className="h-5 w-5 text-brand" />
          AcadMap
        </Link>

        {lookup.status !== 'OK' ? (
          <Card title="Snapshot unavailable">
            <p className="text-sm text-muted">
              {lookup.status === 'REVOKED'
                ? 'The owner revoked this snapshot.'
                : lookup.status === 'EXPIRED'
                  ? 'This snapshot has expired.'
                  : 'This snapshot does not exist.'}
            </p>
            <div className="mt-4">
              <Link to="/calculator">
                <Button variant="secondary">Try the GPA calculator</Button>
              </Link>
            </div>
          </Card>
        ) : (
          <Card title="Academic progress" description="Shared from AcadMap by the student.">
            <dl className="grid gap-3">
              {lookup.snapshot.fields.map((field) => {
                const value = lookup.snapshot.payload[field];
                if (value === undefined) return null;
                return (
                  <div key={field} className="flex items-baseline justify-between gap-4">
                    <dt className="text-sm text-muted">{FIELD_LABELS[field]}</dt>
                    <dd className="tabular font-medium">{String(value)}</dd>
                  </div>
                );
              })}
            </dl>
            <div className="mt-4 flex items-center justify-between gap-2">
              <Badge>
                {lookup.snapshot.expiresAt
                  ? `Expires ${lookup.snapshot.expiresAt.slice(0, 10)}`
                  : 'No expiry'}
              </Badge>
              <Link to="/register">
                <Button size="sm">Track your own CGPA</Button>
              </Link>
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}
