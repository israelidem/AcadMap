import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { registerSchema } from '@shared/schemas';
import { register } from '@/lib/auth';
import { AuthShell } from '@/components/authShell';
import { Button, Input, useToast } from '@/components/ui';

type FieldName = 'fullName' | 'email' | 'password' | 'confirmPassword';

export default function Register() {
  const navigate = useNavigate();
  const toast = useToast();
  const [values, setValues] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const set = (field: FieldName) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(undefined);

    const parsed = registerSchema.safeParse(values);
    if (!parsed.success) {
      const next: Partial<Record<FieldName, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as FieldName | undefined;
        if (field) next[field] ??= issue.message;
      }
      setErrors(next);
      return;
    }

    setErrors({});
    setBusy(true);
    const result = await register(parsed.data.email, parsed.data.password, parsed.data.fullName);
    setBusy(false);

    if (!result.ok) {
      setFormError(result.error ?? 'Could not create your account.');
      return;
    }
    toast('Account created. Let’s set up your academics.');
    navigate('/onboarding', { replace: true });
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="Free, and it takes a couple of minutes to set up."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="text-brand hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <Input
          label="Full name"
          autoComplete="name"
          value={values.fullName}
          onChange={set('fullName')}
          error={errors.fullName}
        />
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          value={values.email}
          onChange={set('email')}
          error={errors.email}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          value={values.password}
          onChange={set('password')}
          error={errors.password}
          hint="At least 8 characters, including a letter and a number."
        />
        <Input
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          value={values.confirmPassword}
          onChange={set('confirmPassword')}
          error={errors.confirmPassword}
        />
        {formError && <p className="am-error">{formError}</p>}
        <Button type="submit" loading={busy}>
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
