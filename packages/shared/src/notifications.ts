/**
 * Notification taxonomy shared by the dashboard (preferences UI, bell) and the services that emit them.
 * Every notification lands in the in-app inbox; e-mail is controlled per category.
 */

export const NOTIFICATION_CATEGORIES = ['deployments', 'domains', 'team', 'billing', 'security', 'product'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export interface CategoryInfo {
  id: NotificationCategory;
  label: string;
  description: string;
  /** Mandatory categories are always e-mailed (receipts, security alerts); the user cannot switch them off. */
  mandatory: boolean;
}

export const CATEGORY_INFO: Readonly<Record<NotificationCategory, CategoryInfo>> = {
  deployments: { id: 'deployments', label: 'Deployments', description: 'A build or release finished or failed, a service went down.', mandatory: false },
  domains: { id: 'domains', label: 'Domains', description: 'A custom domain became active or lost its DNS records.', mandatory: false },
  team: { id: 'team', label: 'Team', description: 'Invitations, new members and role changes.', mandatory: false },
  billing: { id: 'billing', label: 'Billing', description: 'Receipts, failed payments and plan expiry reminders.', mandatory: true },
  security: { id: 'security', label: 'Security', description: 'New API tokens and other sensitive account changes.', mandatory: true },
  product: { id: 'product', label: 'Product updates', description: 'Welcome message and important Orb announcements.', mandatory: false },
};

export type NotificationPrefs = Partial<Record<NotificationCategory, { email: boolean }>>;

/** Whether an e-mail for `category` should be sent given the user's saved preferences. */
export function emailEnabled(category: NotificationCategory, prefs: NotificationPrefs | null | undefined): boolean {
  if (CATEGORY_INFO[category].mandatory) return true;
  return prefs?.[category]?.email ?? true;
}

export const NotificationType = {
  DEPLOYMENT_READY: 'deployment.ready',
  DEPLOYMENT_FAILED: 'deployment.failed',
  SERVICE_DOWN: 'service.down',
  SERVICE_SLEEPING: 'service.sleeping',
  DOMAIN_ACTIVE: 'domain.active',
  DOMAIN_ERROR: 'domain.error',
  TEAM_INVITE: 'team.invite',
  TEAM_JOINED: 'team.joined',
  TEAM_ROLE_CHANGED: 'team.role_changed',
  TEAM_REMOVED: 'team.removed',
  BILLING_PAID: 'billing.paid',
  BILLING_FAILED: 'billing.failed',
  BILLING_EXPIRING: 'billing.expiring',
  BILLING_EXPIRED: 'billing.expired',
  BILLING_GRANTED: 'billing.granted',
  SECURITY_TOKEN: 'security.token_created',
  WELCOME: 'product.welcome',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];
