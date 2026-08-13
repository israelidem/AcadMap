/** In-app feedback / bug report form (feeds the admin Feedback queue). */

import { useState } from 'react';
import { feedbackSchema } from '@shared/schemas';
import { submitFeedback } from '@/lib/actions';
import { useSession } from '@/lib/hooks';
import { Button, Select, Textarea, useToast } from './ui';

export function FeedbackForm({ onDone }: { onDone?: () => void }) {
  const { user } = useSession();
  const toast = useToast();
  const [category, setCategory] = useState<'BUG' | 'FEATURE_REQUEST' | 'GENERAL_FEEDBACK'>('BUG');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string>();

  const handleSubmit = () => {
    const parsed = feedbackSchema.safeParse({ category, message });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check your message.');
      return;
    }
    submitFeedback(user?.id ?? null, user?.email ?? null, parsed.data.category, parsed.data.message);
    setMessage('');
    setError(undefined);
    toast('Thanks — your feedback was sent to the AcadMap team.');
    onDone?.();
  };

  return (
    <div className="grid gap-4">
      <Select
        label="Category"
        value={category}
        onChange={(event) => setCategory(event.target.value as typeof category)}
      >
        <option value="BUG">Bug report</option>
        <option value="FEATURE_REQUEST">Feature request</option>
        <option value="GENERAL_FEEDBACK">General feedback</option>
      </Select>
      <Textarea
        label="Message"
        placeholder="Tell us what happened or what you'd like to see…"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        error={error}
        hint="At least 10 characters. Please don't include passwords."
      />
      <Button onClick={handleSubmit}>Send feedback</Button>
    </div>
  );
}
