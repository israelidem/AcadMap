import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { loginSchema } from '@shared/schemas';
import { login } from '@/lib/auth';
import { AuthShell } from '@/components/authShell';
import { Button, Input, useToast } from '@/components/ui';

export default function Login() {
  const navigate = useNavigate();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(undefined);

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'email' || field === 'password') next[field] ??= issue.message;
      }
      setErrors(next);
      return;
    }

    setErrors({});
    setBusy(true);
    const result = await login(parsed.data.email, parsed.data.password);
    setBusy(false);

    if (!result.ok) {
      setFormError(result.error ?? 'Could not sign you in.');
      return;
    }
    toast('Welcome back.');
    navigate('/app', { replace: true });
  };

  return (
    <AuthShell
      title="Log in"
      subtitle="Pick up where you left off."
      footer={
        <>
          New to AcadMap?{' '}
          <Link to="/register" className="text-brand hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={errors.email}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={errors.password}
        />
        {formError && <p className="am-error">{formError}</p>}
        <Button type="submit" loading={busy}>
          Log in
        </Button>
        <Link to="/recover" className="text-center text-sm text-brand hover:underline">
          Forgot your password?
        </Link>
      </form>
    </AuthShell>
  );
}
