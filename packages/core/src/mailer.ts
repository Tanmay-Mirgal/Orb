import nodemailer, { type Transporter } from 'nodemailer';
import { env, envBool, envInt } from './config';
import { createLogger } from './logger';

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export interface EmailMessage extends EmailContent {
  to: string;
  replyTo?: string;
}

export type EmailResult = { sent: true; id: string } | { sent: false; reason: string };

/**
 * Plain nodemailer over SMTP, no cloud service required. Simplest setup is a Gmail account:
 *   SMTP_USER=you@gmail.com  SMTP_PASSWORD=<16-char Google app password>
 * The host defaults to smtp.gmail.com for @gmail.com users and the sender to that same address.
 * Any other SMTP server works too (set SMTP_HOST, and SMTP_PORT if it is not 587).
 */
export function mailConfig() {
  const user = env('SMTP_USER');
  const host = env('SMTP_HOST') ?? (user && /@(gmail|googlemail)\.com$/i.test(user) ? 'smtp.gmail.com' : undefined);
  const port = envInt('SMTP_PORT', 587);
  return {
    enabled: Boolean(host),
    host,
    port,
    // Port 465 = implicit TLS; 587/25 = STARTTLS, which nodemailer negotiates by itself.
    secure: envBool('SMTP_SECURE', port === 465),
    user,
    // Google shows app passwords as "abcd efgh ijkl mnop"; the spaces are not part of the password.
    password: env('SMTP_PASSWORD')?.replace(/\s+/g, ''),
    // Gmail only sends as the logged-in address, so that is the natural default sender.
    from: env('EMAIL_FROM') ?? (user ? `Orb <${user}>` : 'Orb <no-reply@localhost>'),
    replyTo: env('EMAIL_REPLY_TO'),
  };
}

const logger = createLogger('mailer');
const g = globalThis as unknown as { __orbMailer?: { key: string; transport: Transporter } };

function transport(): Transporter | null {
  const cfg = mailConfig();
  if (!cfg.enabled || !cfg.host) return null;
  const key = `${cfg.host}:${cfg.port}:${cfg.user ?? ''}`;
  if (g.__orbMailer?.key === key) return g.__orbMailer.transport;
  const t = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.password ?? '' } : undefined,
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  g.__orbMailer = { key, transport: t };
  return t;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isTransient(err: unknown): boolean {
  const e = err as { responseCode?: number; code?: string };
  if (typeof e.responseCode === 'number') return e.responseCode >= 400 && e.responseCode < 500;
  return ['ETIMEDOUT', 'ECONNRESET', 'ECONNECTION', 'ESOCKET', 'EDNS', 'ETIMEOUT'].includes(e.code ?? '');
}

/**
 * Sends one e-mail. Never throws: a mail outage must not fail a deployment or a payment. Without SMTP settings the
 * message is only logged, which keeps local development working with no mail server.
 */
export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const cfg = mailConfig();
  const t = transport();
  if (!t) {
    logger.info({ to: message.to, subject: message.subject }, 'e-mail not sent: set SMTP_USER + SMTP_PASSWORD (Gmail) or SMTP_HOST');
    return { sent: false, reason: 'SMTP is not configured' };
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const info = await t.sendMail({
        from: cfg.from,
        to: message.to,
        replyTo: message.replyTo ?? cfg.replyTo,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: { 'X-Auto-Response-Suppress': 'OOF, AutoReply', 'Auto-Submitted': 'auto-generated' },
      });
      return { sent: true, id: info.messageId };
    } catch (err) {
      lastError = err;
      if (!isTransient(err)) break;
      await sleep(1000 * 3 ** attempt);
    }
  }
  logger.warn({ to: message.to, subject: message.subject, err: lastError instanceof Error ? lastError.message : String(lastError) }, 'e-mail failed');
  return { sent: false, reason: lastError instanceof Error ? lastError.message : 'send failed' };
}
