/**
 * Account recovery.
 *
 * The server emails a link, and the screen only claims an email was sent once the
 * server confirms it sent one — the previous version said so unconditionally,
 * which is the bug this fixes. There is no offline path: only the account's real
 * password can be changed, and only the server holds that.
 *
 * Opening the emailed link lands here with `?token=`, which is filled in for the
 * student so the only thing left to do is choose a password.

 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { requestResetSchema, resetPasswordSchema } from '@shared/schemas';
import { requestPasswordReset, resetPassword } from '@/lib/auth';
import { AuthShell } from '@/components/authShell';
import { Button, Input, useToast } from '@/components/ui';

export default function Recover() {
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [email, setEmail] = useState('');
  /** Set when the server has actually sent an email. */
  const [emailSent, setEmailSent] = useState(false);

  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [busy, setBusy] = useState(false);

  // Arriving from the emailed link: carry the token into the form so the student
  // never has to copy it by hand.
  useEffect(() => {
    const fromLink = params.get('token');
    if (fromLink) setToken(fromLink);
  }, [params]);

  const requestCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(undefined);

    const parsed = requestResetSchema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }

    setRequesting(true);
    const result = await requestPasswordReset(parsed.data.email);
    setRequesting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setEmailSent(true);
    // Deliberately hedged: the server answers the same way for an address

    // it does not know, so this cannot promise an email will arrive.
    toast('If that account exists, a reset link is on its way.', 'info');
  };


  const submitReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(undefined);

    if (password !== confirmPassword) {
      setError('Those passwords do not match.');
      return;
    }

    const parsed = resetPasswordSchema.safeParse({ token, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }

    setBusy(true);
    const result = await resetPassword(parsed.data.token, parsed.data.password);
    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? 'That reset link or code is invalid or has expired.');
      return;
    }

    setDone(true);
    toast('Password updated.');
  };

  if (done) {
    return (
      <AuthShell
        title="Password updated"
        subtitle="Log in with your new password. It works on every device."
      >
        <Button className="w-full" onClick={() => navigate('/login', { replace: true })}>
          Go to log in
        </Button>

      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Recover access"
      subtitle="We email you a link. Open it, then choose a new password."
      footer={
        <Link to="/login" className="text-brand hover:underline">
          Back to log in
        </Link>
      }
    >
      <form className="grid gap-4" onSubmit={requestCode} noValidate>
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button type="submit" variant="secondary" loading={requesting}>
          Email me a reset link
        </Button>
      </form>

      {/* Announced, because the outcome of the request is the whole point of it. */}
      <div aria-live="polite">
        {emailSent && (
          <p className="am-hint mt-3">
            If that account exists, a reset link is on its way to{' '}
            <span className="font-medium break-all">{email}</span>. It is valid for one hour.
            Check your spam folder if it does not arrive.
          </p>
        )}

      </div>


      <hr className="my-5 border-border" />

      <form className="grid gap-4" onSubmit={submitReset} noValidate>
        <Input
          label="Reset link code"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          hint="Filled in automatically when you open the link from your email."
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
