import { afterEach, describe, expect, it } from 'vitest';
import { mailConfig, sendEmail } from './mailer';

const KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_SECURE', 'EMAIL_FROM'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

function setEnv(values: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, values);
}

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('mail configuration', () => {
  it('needs only a Gmail address and app password', () => {
    setEnv({ SMTP_USER: 'someone@gmail.com', SMTP_PASSWORD: 'abcd efgh ijkl mnop' });
    const cfg = mailConfig();
    expect(cfg).toMatchObject({ enabled: true, host: 'smtp.gmail.com', port: 587, secure: false, password: 'abcdefghijklmnop' });
    expect(cfg.from).toBe('Orb <someone@gmail.com>');
  });

  it('uses an explicit host, port and sender for any other SMTP server', () => {
    setEnv({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465', SMTP_USER: 'u', SMTP_PASSWORD: 'p', EMAIL_FROM: 'Orb <hi@example.com>' });
    expect(mailConfig()).toMatchObject({ host: 'smtp.example.com', port: 465, secure: true, from: 'Orb <hi@example.com>' });
  });

  it('is disabled, and sending resolves instead of throwing, when nothing is configured', async () => {
    setEnv({});
    expect(mailConfig().enabled).toBe(false);
    await expect(sendEmail({ to: 'a@example.com', subject: 's', html: '<p>x</p>', text: 'x' })).resolves.toEqual({ sent: false, reason: 'SMTP is not configured' });
  });
});
