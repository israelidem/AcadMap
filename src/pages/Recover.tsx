/**
 * Account recovery.
 *
 * Email delivery is out of scope for the MVP (no paid mail provider), so the
 * reset token is issued in-app and pasted back in. The API shape stays the same
 * once an email provider is added.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { requestResetSchema, resetPasswordSchema } from '@shared/schemas';
import { requestPasswordReset, resetPassword } from '@/lib/auth';
import { AuthShell } from '@/components/authShell';
import { Button, Input, useToast } from '@/components/ui';

export default function Recover() {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const requestToken = (event: React.FormEvent) => {
    event.preventDefault();
    setError(undefined);

    const parsed = requestResetSchema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }

    const result = requestPasswordReset(parsed.data.email);
    // Never reveal whether the address exists.
    if ('token' in result) {
      setIssuedToken(result.token);
      setToken(result.token);
    } else {
      setIssuedToken(null);
    }
    toast('If that account exists, a reset code has been issued.', 'info');
  };

  const submitReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(undefined);

    const parsed = resetPasswordSchema.safeParse({ token, password, confirmPassword });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }

    setBusy(true);
    const result = await resetPassword(parsed.data.token, parsed.data.password);
    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? 'That reset code is invalid or has expired.');
      return;
    }
    setDone(true);
    toast('Password updated. You can log in now.');
  };

  if (done) {
    return (
      <AuthShell title="Password updated" subtitle="Use your new password to log in.">
        <Link to="/login">
          <Button className="w-full">Go to log in</Button>
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Recover access"
      subtitle="Request a reset code, then choose a new password."
      footer={
        <Link to="/login" className="text-brand hover:underline">
          Back to log in
        </Link>
      }
    >
      <form className="grid gap-4" onSubmit={requestToken} noValidate>
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button type="submit" variant="secondary">
          Request reset code
        </Button>
      </form>

      {issuedToken && (
        <p className="am-hint mt-3 break-all">
          Development build: your reset code is <span className="font-mono">{issuedToken}</span>
        </p>
      )}

      <hr className="my-5 border-border" />

      <form className="grid gap-4" onSubmit={submitReset} noValidate>
        <Input
          label="Reset code"
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Input
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
        />
        {error && <p className="am-error">{error}</p>}
        <Button type="submit" loading={busy}>
          Set new password
        </Button>
      </form>
    </AuthShell>
  );
}
