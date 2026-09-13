/**
 * Public snapshot view — /share/:token
 *
 * Only the fields the owner selected are rendered; the page never reads the
 * owner's academic records directly, just the frozen payload.
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LogoMark } from '@/components/brand';
import type { ShareField } from '@shared/types';
import { ApiError, api, type PublicSnapshot } from '@/lib/api';
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
  const [snapshot, setSnapshot] = useState<PublicSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'NOT_FOUND' | 'ERROR' | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setSnapshot(null);
    api.sharedSnapshot(token, controller.signal)
      .then((response) => setSnapshot(response.snapshot))
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof ApiError && reason.status === 404 ? 'NOT_FOUND' : 'ERROR');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [token]);

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-lg place-items-center px-4 py-10">
      <div className="w-full">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2 font-semibold">
          <LogoMark className="h-5 w-5" />

          AcadMap
        </Link>

        {loading ? (
          <Card title="Loading snapshot">
            <p className="text-sm text-muted" role="status">Fetching the shared academic record…</p>
          </Card>
        ) : !snapshot ? (
          <Card title="Snapshot unavailable">
            <p className="text-sm text-muted">
              {error === 'ERROR'
                ? 'The snapshot could not be loaded. Check your connection and try again.'
                : 'This snapshot does not exist, has expired, or was revoked.'}
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
              {snapshot.fields.map((field) => {
                const value = snapshot.payload[field];
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
                {snapshot.expiresAt
                  ? `Expires ${snapshot.expiresAt.slice(0, 10)}`
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
