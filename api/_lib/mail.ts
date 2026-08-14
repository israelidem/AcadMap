/**
 * Transactional email.
 *
 * Sent over the provider's HTTP API rather than SMTP, because the Edge runtime
 * has no TCP sockets — an SMTP library cannot run here at all. HTTP also means no
 * dependency and no cold-start cost.
 *
 * Two providers are supported because their free allowances differ enough to
 * matter for a student app, and neither is worth being locked into. Whichever key
 * is present is used; Brevo wins if both are, since it is the one you would set
 * deliberately having already had Resend working.
 *
 * Configuration, all from the environment:
 *
 *   BREVO_API_KEY   Brevo (brevo.com) key, from Settings → SMTP & API → API keys.
 *   RESEND_API_KEY  Resend key. Either one is enough; neither means nothing is
 *                   sent and `sendMail` says so, which callers surface instead of
 *                   pretending.
 *   MAIL_FROM       the From header, e.g. `AcadMap <no-reply@acadmap.app>`. The
 *                   domain must be verified with whichever provider you use, or
 *                   the send is rejected.
 *   MAIL_REPLY_TO   optional address for replies.
 *
 * Why this file refuses to fail silently: the reset flow previously told
 * students an email was on its way when nothing had been sent, and a
 * "successful" send that never arrives is worse than an honest error.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';


export interface MailMessage {
  to: string;
  subject: string;
  /** Plain text alternative. Always sent: some clients prefer it. */
  text: string;
  html: string;
}

export type MailResult = { ok: true; id: string | null } | { ok: false; error: string };

function env(name: string): string {
  const value = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env?.[name];
  return (value ?? '').trim();
}

/** Whichever provider this deployment is set up for. */
function provider(): 'brevo' | 'resend' | null {
  if (env('BREVO_API_KEY')) return 'brevo';
  if (env('RESEND_API_KEY')) return 'resend';
  return null;
}

/** True when the deployment can actually send. */
export function mailConfigured(): boolean {
  return provider() !== null && env('MAIL_FROM') !== '';
}

/**
 * Splits `AcadMap <no-reply@acadmap.app>` into its parts.
 *
 * Resend takes the header as written; Brevo wants the name and address as
 * separate fields, so the header has to be taken apart for it.
 */
function parseFrom(value: string): { email: string; name?: string } {
  const match = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (!match) return { email: value.trim() };
  const name = match[1].replace(/^"|"$/g, '').trim();
  return { email: match[2].trim(), ...(name ? { name } : {}) };
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  const which = provider();
  const from = env('MAIL_FROM');

  if (!which || !from) {
    return {
      ok: false,
      error:
        'Email is not configured on this deployment (set MAIL_FROM and one of ' +
        'BREVO_API_KEY or RESEND_API_KEY).',
    };
  }

  const replyTo = env('MAIL_REPLY_TO');
  const sender = parseFrom(from);

  const request: { url: string; headers: Record<string, string>; body: unknown } =
    which === 'brevo'

      ? {
          url: BREVO_ENDPOINT,
          headers: { 'api-key': env('BREVO_API_KEY'), 'Content-Type': 'application/json' },
          body: {
            sender,
            to: [{ email: message.to }],
            subject: message.subject,
            textContent: message.text,
            htmlContent: message.html,
            ...(replyTo ? { replyTo: { email: replyTo } } : {}),
          },
        }
      : {
          url: RESEND_ENDPOINT,
          headers: {
            Authorization: `Bearer ${env('RESEND_API_KEY')}`,
            'Content-Type': 'application/json',
          },
          body: {
            from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
            ...(replyTo ? { reply_to: replyTo } : {}),
          },
        };

  let response: Response;
  try {
    response = await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
    });
  } catch {
    return { ok: false, error: 'Could not reach the email provider.' };
  }

  if (!response.ok) {
    // The provider's own message ("domain not verified", "invalid to") is the
    // only useful diagnostic here, so it is passed through to the log.
    const detail = await response.text().catch(() => '');
    return {
      ok: false,
      error: `${which} rejected the message (${response.status}): ${detail.slice(0, 300)}`,
    };
  }

  // Resend returns `id`, Brevo returns `messageId`. Only used for logging.
  const payload = (await response.json().catch(() => null)) as {
    id?: string;
    messageId?: string;
  } | null;
  return { ok: true, id: payload?.id ?? payload?.messageId ?? null };
}


/* ------------------------------- templates -------------------------------- */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The reset email.
 *
 * The link is shown as text as well as linked: students on webmail clients that
 * strip anchors, or reading on a phone and typing on a laptop, need to be able
 * to see and copy it. Expiry is stated because a link that has quietly gone
 * stale is the most common support question in this flow.
 */
export function passwordResetEmail(link: string, minutes: number): Omit<MailMessage, 'to'> {
  const safeLink = escapeHtml(link);

  return {
    subject: 'Reset your AcadMap password',
    text: [
      'You asked to reset your AcadMap password.',
      '',
      `Open this link to choose a new one (valid for ${minutes} minutes):`,
      link,
      '',
      'If you did not ask for this, you can ignore this email — your password has',
      'not changed.',
    ].join('\n'),
    html: [
      '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.5;color:#111827">',
      '<h1 style="font-size:20px;margin:0 0 16px">Reset your AcadMap password</h1>',
      '<p style="margin:0 0 16px">You asked to reset your AcadMap password. Choose a new one here:</p>',
      `<p style="margin:0 0 24px"><a href="${safeLink}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px">Choose a new password</a></p>`,
      `<p style="margin:0 0 16px;color:#4b5563;font-size:14px">The link is valid for ${minutes} minutes. If the button does not work, copy this address into your browser:</p>`,
      `<p style="margin:0 0 24px;word-break:break-all;font-size:14px"><a href="${safeLink}">${safeLink}</a></p>`,
      '<p style="margin:0;color:#6b7280;font-size:14px">If you did not ask for this, you can ignore this email — your password has not changed.</p>',
      '</div>',
    ].join(''),
  };
}
