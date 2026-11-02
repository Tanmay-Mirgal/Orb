import type { EmailContent } from './mailer';

/**
 * Transactional e-mails. Plain table layout with inline styles (what mail clients actually render), no images,
 * so nothing is blocked and nothing needs hosting. Every dynamic value passes through `esc()`: project names,
 * commit messages and team names are user-controlled and must never be able to inject markup into a message.
 */

const ACCENT = '#4a63ff';
const INK = '#0c0c10';
const MUTED = '#62626d';
const LINE = '#e4e4ea';

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface Layout {
  preheader: string;
  heading: string;
  /** Trusted HTML (already escaped by the caller). */
  body: string;
  cta?: { label: string; url: string };
  /** Plain-text version of `body`. */
  text: string;
  footnote?: string;
}

function layout(l: Layout): { html: string; text: string } {
  const button = l.cta
    ? `<tr><td style="padding:8px 0 4px"><a href="${esc(l.cta.url)}" style="display:inline-block;background:${INK};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:9px">${esc(l.cta.label)}</a></td></tr>`
    : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(l.heading)}</title></head>
<body style="margin:0;padding:0;background:#f7f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${INK}">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(l.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f9"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 16px;font-size:16px;font-weight:700;letter-spacing:-0.01em"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${ACCENT};margin-right:8px"></span>Orb</td></tr>
<tr><td style="background:#ffffff;border:1px solid ${LINE};border-radius:14px;padding:28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="font-size:20px;font-weight:650;letter-spacing:-0.01em;padding-bottom:12px">${esc(l.heading)}</td></tr>
<tr><td style="font-size:14px;line-height:1.65;color:#2a2a33;padding-bottom:16px">${l.body}</td></tr>
${button}
</table></td></tr>
<tr><td style="padding:16px 8px 0;font-size:12px;line-height:1.6;color:${MUTED}">${l.footnote ? `${esc(l.footnote)}<br>` : ''}You get this e-mail because of activity on your Orb account. Manage what we send in Settings → Notifications.</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${l.heading}\n\n${l.text}${l.cta ? `\n\n${l.cta.label}: ${l.cta.url}` : ''}\n\n— Orb${l.footnote ? `\n${l.footnote}` : ''}`;
  return { html, text };
}

function make(subject: string, l: Layout): EmailContent {
  const { html, text } = layout(l);
  return { subject, html, text };
}

const p = (s: string) => `<p style="margin:0 0 12px">${s}</p>`;
const b = (s: unknown) => `<strong style="font-weight:600">${esc(s)}</strong>`;
const code = (s: unknown) =>
  `<code style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;background:#f0f0f4;border-radius:5px;padding:2px 6px">${esc(s)}</code>`;
const kv = (rows: Array<[string, string]>) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 8px;border:1px solid ${LINE};border-radius:10px">${rows
    .map(
      ([k, v], i) =>
        `<tr><td style="padding:9px 12px;font-size:13px;color:${MUTED};${i ? `border-top:1px solid ${LINE}` : ''}">${esc(k)}</td><td align="right" style="padding:9px 12px;font-size:13px;font-weight:600;${i ? `border-top:1px solid ${LINE}` : ''}">${esc(v)}</td></tr>`,
    )
    .join('')}</table>`;

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0 })}`;
const day = (d: Date | string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export const emailTemplates = {
  welcome: (d: { name: string; dashboardUrl: string }) =>
    make('Welcome to Orb', {
      preheader: 'Deploy your first project in under a minute.',
      heading: `Welcome, ${d.name.split(' ')[0] || 'there'}`,
      body:
        p('Your Orb account is ready. Import a GitHub repository and Orb detects the framework, builds it and puts it on a live HTTPS URL.') +
        p('Every push to your production branch deploys automatically, and any older deployment is one click away if you need to roll back.'),
      text: 'Your Orb account is ready. Import a GitHub repository and Orb builds it and puts it on a live HTTPS URL. Every push deploys automatically.',
      cta: { label: 'Deploy your first project', url: `${d.dashboardUrl}/dashboard/new` },
    }),

  invitation: (d: { inviterName: string; orgName: string; role: string; acceptUrl: string; expiresInDays: number }) =>
    make(`${d.inviterName} invited you to ${d.orgName} on Orb`, {
      preheader: `Join ${d.orgName} as ${d.role}.`,
      heading: `Join ${d.orgName} on Orb`,
      body:
        p(`${b(d.inviterName)} invited you to collaborate on ${b(d.orgName)} as ${b(d.role)}.`) +
        p('You will see the team\'s projects, deployments and logs as soon as you accept. Sign in with the GitHub account that uses this e-mail address.') +
        p(`<span style="color:${MUTED}">This invitation expires in ${d.expiresInDays} days.</span>`),
      text: `${d.inviterName} invited you to collaborate on ${d.orgName} as ${d.role}. Sign in with the GitHub account that uses this e-mail address. The invitation expires in ${d.expiresInDays} days.`,
      cta: { label: 'Accept invitation', url: d.acceptUrl },
      footnote: 'If you were not expecting this, you can ignore this e-mail.',
    }),

  memberJoined: (d: { memberName: string; orgName: string; role: string; teamUrl: string }) =>
    make(`${d.memberName} joined ${d.orgName}`, {
      preheader: `${d.memberName} accepted the invitation.`,
      heading: `${d.memberName} joined your team`,
      body: p(`${b(d.memberName)} accepted the invitation to ${b(d.orgName)} and now has the ${b(d.role)} role.`),
      text: `${d.memberName} accepted the invitation to ${d.orgName} and now has the ${d.role} role.`,
      cta: { label: 'Manage team', url: d.teamUrl },
    }),

  roleChanged: (d: { orgName: string; role: string; byName: string; dashboardUrl: string }) =>
    make(`Your role in ${d.orgName} changed`, {
      preheader: `You are now ${d.role}.`,
      heading: 'Your role changed',
      body: p(`${b(d.byName)} changed your role in ${b(d.orgName)} to ${b(d.role)}.`),
      text: `${d.byName} changed your role in ${d.orgName} to ${d.role}.`,
      cta: { label: 'Open dashboard', url: d.dashboardUrl },
    }),

  removedFromTeam: (d: { orgName: string; byName: string }) =>
    make(`You were removed from ${d.orgName}`, {
      preheader: 'You no longer have access to this team.',
      heading: `You were removed from ${d.orgName}`,
      body: p(`${b(d.byName)} removed you from ${b(d.orgName)}. You no longer have access to its projects.`),
      text: `${d.byName} removed you from ${d.orgName}. You no longer have access to its projects.`,
    }),

  deploymentReady: (d: { projectName: string; url: string; commitMessage?: string | null; environment: string; dashboardUrl: string }) =>
    make(`✓ ${d.projectName} is live`, {
      preheader: d.commitMessage ? clip(d.commitMessage, 90) : 'Your deployment finished.',
      heading: `${d.projectName} deployed`,
      body:
        p(`Your ${esc(d.environment)} deployment is ready${d.commitMessage ? `: ${b(clip(d.commitMessage, 120))}` : ''}.`) +
        p(`<a href="${esc(d.url)}" style="color:${ACCENT};text-decoration:none;font-weight:600">${esc(d.url.replace(/^https?:\/\//, ''))}</a>`),
      text: `Your ${d.environment} deployment of ${d.projectName} is ready: ${d.url}`,
      cta: { label: 'View deployment', url: d.dashboardUrl },
    }),

  deploymentFailed: (d: { projectName: string; error?: string | null; commitMessage?: string | null; dashboardUrl: string }) =>
    make(`✗ ${d.projectName} failed to deploy`, {
      preheader: d.error ? clip(d.error, 90) : 'Open the build log to see what went wrong.',
      heading: `${d.projectName} failed to deploy`,
      body:
        p(`The latest deployment${d.commitMessage ? ` (${b(clip(d.commitMessage, 100))})` : ''} did not finish. The previous version, if any, is still serving traffic.`) +
        (d.error ? p(code(clip(d.error, 300))) : '') +
        p('Open the build log to see the exact step that failed.'),
      text: `The latest deployment of ${d.projectName} failed.${d.error ? ` ${clip(d.error, 300)}` : ''} The previous version, if any, is still serving traffic.`,
      cta: { label: 'Open build log', url: d.dashboardUrl },
    }),

  serviceDown: (d: { projectName: string; dashboardUrl: string }) =>
    make(`${d.projectName} lost its instances`, {
      preheader: 'Orb is restarting them automatically.',
      heading: `${d.projectName} lost an instance`,
      body:
        p(`One or more running instances of ${b(d.projectName)} stopped responding. Orb is scheduling replacements automatically.`) +
        p('If this keeps happening, check the runtime logs — the app may be crashing or running out of memory.'),
      text: `One or more instances of ${d.projectName} stopped responding. Orb is scheduling replacements automatically.`,
      cta: { label: 'Open runtime logs', url: d.dashboardUrl },
    }),

  domainActive: (d: { domain: string; projectName: string; dashboardUrl: string }) =>
    make(`${d.domain} is live`, {
      preheader: 'DNS is correct and HTTPS is on.',
      heading: `${d.domain} is live`,
      body: p(`DNS for ${b(d.domain)} points at Orb, and HTTPS is issued automatically. It now serves ${b(d.projectName)}.`),
      text: `DNS for ${d.domain} points at Orb and HTTPS is on. It now serves ${d.projectName}.`,
      cta: { label: 'Open project', url: d.dashboardUrl },
    }),

  domainError: (d: { domain: string; detail?: string | null; dashboardUrl: string }) =>
    make(`${d.domain} needs attention`, {
      preheader: 'Its DNS records no longer point at Orb.',
      heading: `${d.domain} needs attention`,
      body: p(`Orb can no longer see DNS records for ${b(d.domain)} that point at the platform, so it may stop serving.`) + (d.detail ? p(code(clip(d.detail, 240))) : ''),
      text: `Orb can no longer see DNS records for ${d.domain} that point at the platform.${d.detail ? ` ${clip(d.detail, 240)}` : ''}`,
      cta: { label: 'Check DNS records', url: d.dashboardUrl },
    }),

  paymentReceipt: (d: { orgName: string; planName: string; interval: string; amountPaise: number; paymentId: string; periodStart: Date; periodEnd: Date; billingUrl: string }) =>
    make(`Payment received — ${d.planName} plan`, {
      preheader: `${rupees(d.amountPaise)} paid for ${d.orgName}.`,
      heading: 'Thanks — payment received',
      body:
        p(`${b(d.orgName)} is on the ${b(d.planName)} plan until ${b(day(d.periodEnd))}.`) +
        kv([
          ['Plan', `${d.planName} (${d.interval})`],
          ['Amount', rupees(d.amountPaise)],
          ['Period', `${day(d.periodStart)} – ${day(d.periodEnd)}`],
          ['Payment ID', d.paymentId],
        ]),
      text: `${d.orgName} is on the ${d.planName} plan until ${day(d.periodEnd)}. Amount ${rupees(d.amountPaise)}, payment ${d.paymentId}.`,
      cta: { label: 'View billing', url: d.billingUrl },
    }),

  paymentFailed: (d: { orgName: string; planName: string; reason?: string | null; billingUrl: string }) =>
    make(`Payment failed — ${d.planName} plan`, {
      preheader: 'Nothing was charged. You can try again.',
      heading: 'Your payment did not go through',
      body:
        p(`We could not complete the payment for the ${b(d.planName)} plan on ${b(d.orgName)}.${d.reason ? ` The bank said: ${esc(clip(d.reason, 160))}.` : ''}`) +
        p('Your current plan is unchanged. If money left your account it is refunded automatically by the bank, usually within 5–7 working days.'),
      text: `The payment for the ${d.planName} plan on ${d.orgName} failed.${d.reason ? ` ${clip(d.reason, 160)}.` : ''} Your plan is unchanged.`,
      cta: { label: 'Try again', url: d.billingUrl },
    }),

  planExpiring: (d: { orgName: string; planName: string; expiresAt: Date; daysLeft: number; billingUrl: string }) =>
    make(`Your ${d.planName} plan ends in ${d.daysLeft} day${d.daysLeft === 1 ? '' : 's'}`, {
      preheader: `${d.orgName} returns to Hobby on ${day(d.expiresAt)}.`,
      heading: `${d.planName} plan ends ${day(d.expiresAt)}`,
      body:
        p(`${b(d.orgName)} is on the ${b(d.planName)} plan until ${b(day(d.expiresAt))}. After that it returns to Hobby: ${b('one member')}, fewer projects and services that sleep when idle.`) +
        p('Renew now and the new period starts when the current one ends — you lose nothing.'),
      text: `${d.orgName} is on the ${d.planName} plan until ${day(d.expiresAt)}, then returns to Hobby. Renew to keep your team features.`,
      cta: { label: 'Renew plan', url: d.billingUrl },
    }),

  planExpired: (d: { orgName: string; planName: string; billingUrl: string }) =>
    make(`${d.orgName} is back on the Hobby plan`, {
      preheader: `The ${d.planName} plan ended.`,
      heading: 'Your plan ended',
      body:
        p(`The ${b(d.planName)} plan for ${b(d.orgName)} ended, so the team is now on Hobby. Nothing was deleted: projects keep running, but Hobby limits apply to new work and idle services sleep.`) +
        p('Upgrade any time to get team members, larger instances and always-on services back.'),
      text: `The ${d.planName} plan for ${d.orgName} ended; the team is now on Hobby. Nothing was deleted.`,
      cta: { label: 'Choose a plan', url: d.billingUrl },
    }),

  planGranted: (d: { orgName: string; planName: string; expiresAt: Date; billingUrl: string }) =>
    make(`${d.planName} plan activated for ${d.orgName}`, {
      preheader: `Complimentary until ${day(d.expiresAt)}.`,
      heading: `${d.planName} plan is active`,
      body: p(`${b(d.orgName)} now has the ${b(d.planName)} plan at no charge until ${b(day(d.expiresAt))}.`),
      text: `${d.orgName} now has the ${d.planName} plan at no charge until ${day(d.expiresAt)}.`,
      cta: { label: 'View plan', url: d.billingUrl },
    }),

  tokenCreated: (d: { tokenName: string; settingsUrl: string }) =>
    make('A new API token was created', {
      preheader: `Token "${d.tokenName}" can act on your account.`,
      heading: 'New API token created',
      body:
        p(`A personal access token named ${b(d.tokenName)} was just created on your account. It can deploy and manage projects on your behalf.`) +
        p('If this was not you, revoke it immediately and review your account.'),
      text: `A personal access token named "${d.tokenName}" was created on your account. If this was not you, revoke it immediately.`,
      cta: { label: 'Review tokens', url: d.settingsUrl },
    }),
};
