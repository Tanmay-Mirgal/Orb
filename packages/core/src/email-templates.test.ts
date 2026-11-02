import { describe, expect, it } from 'vitest';
import { emailTemplates, esc } from './email-templates';

describe('email templates', () => {
  it('escapes user-controlled values everywhere they appear', () => {
    const evil = '<img src=x onerror=alert(1)>"\'&';
    const mails = [
      emailTemplates.deploymentFailed({ projectName: evil, error: evil, commitMessage: evil, dashboardUrl: 'https://orb.example/p' }),
      emailTemplates.deploymentReady({ projectName: evil, url: 'https://x.example', commitMessage: evil, environment: 'production', dashboardUrl: 'https://orb.example/p' }),
      emailTemplates.invitation({ inviterName: evil, orgName: evil, role: 'member', acceptUrl: 'https://orb.example/invite/t', expiresInDays: 7 }),
      emailTemplates.domainError({ domain: evil, detail: evil, dashboardUrl: 'https://orb.example/p' }),
      emailTemplates.memberJoined({ memberName: evil, orgName: evil, role: 'admin', teamUrl: 'https://orb.example/t' }),
    ];
    for (const mail of mails) {
      expect(mail.html).not.toContain('<img');
      expect(mail.html).toContain('&lt;img');
    }
  });

  it('renders a receipt in rupees with the paid period', () => {
    const mail = emailTemplates.paymentReceipt({
      orgName: 'Acme',
      planName: 'Team',
      interval: 'yearly',
      amountPaise: 4_999_000,
      paymentId: 'pay_123',
      periodStart: new Date('2026-11-02T00:00:00Z'),
      periodEnd: new Date('2027-11-02T00:00:00Z'),
      billingUrl: 'https://orb.example/dashboard/billing',
    });
    expect(mail.subject).toContain('Team');
    expect(mail.html).toContain('₹49,990');
    expect(mail.text).toContain('pay_123');
  });

  it('esc handles nullish values', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
    expect(esc('a&b')).toBe('a&amp;b');
  });
});
