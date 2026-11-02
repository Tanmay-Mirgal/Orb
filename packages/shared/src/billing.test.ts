import { describe, expect, it } from 'vitest';
import { CATEGORY_INFO, NOTIFICATION_CATEGORIES, addBillingPeriod, can, emailEnabled, getOrgPlan, planPricePaise, planRank } from './index';

describe('billing periods', () => {
  it('adds calendar months and clamps to the end of shorter months', () => {
    expect(addBillingPeriod(new Date('2026-01-31T10:00:00Z'), 'monthly').toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addBillingPeriod(new Date('2028-01-31T10:00:00Z'), 'monthly').toISOString()).toBe('2028-02-29T10:00:00.000Z');
    expect(addBillingPeriod(new Date('2026-11-02T00:00:00Z'), 'monthly').toISOString()).toBe('2026-12-02T00:00:00.000Z');
    expect(addBillingPeriod(new Date('2026-11-02T00:00:00Z'), 'yearly').toISOString()).toBe('2027-11-02T00:00:00.000Z');
  });

  it('prices every paid plan in paise, yearly cheaper than twelve months', () => {
    for (const id of ['pro', 'team']) {
      const monthly = planPricePaise(id, 'monthly');
      const yearly = planPricePaise(id, 'yearly');
      expect(monthly).toBeGreaterThan(0);
      expect(monthly % 100).toBe(0);
      expect(yearly).toBeLessThan(monthly * 12);
    }
    expect(planPricePaise('free', 'monthly')).toBe(0);
  });

  it('orders plans and only lets owners spend money', () => {
    expect(planRank('free')).toBeLessThan(planRank('pro'));
    expect(planRank('pro')).toBeLessThan(planRank('team'));
    expect(can('owner', 'billing:manage')).toBe(true);
    expect(can('admin', 'billing:manage')).toBe(false);
    expect(can('admin', 'billing:read')).toBe(true);
    expect(can('member', 'billing:read')).toBe(false);
  });
});

describe('cost guards', () => {
  it('only the free plan sleeps and has a small container allowance', () => {
    const hobby = getOrgPlan('free');
    expect(hobby.idleSleepMinutes).toBeGreaterThan(0);
    expect(hobby.maxContainerProjects).toBeLessThan(hobby.maxProjects);
    expect(getOrgPlan('pro').idleSleepMinutes).toBeNull();
    expect(getOrgPlan('team').idleSleepMinutes).toBeNull();
  });
});

describe('notification preferences', () => {
  it('defaults to e-mail on, honours opt-out, and never mutes billing or security', () => {
    expect(emailEnabled('deployments', null)).toBe(true);
    expect(emailEnabled('deployments', { deployments: { email: false } })).toBe(false);
    expect(emailEnabled('billing', { billing: { email: false } })).toBe(true);
    expect(emailEnabled('security', { security: { email: false } })).toBe(true);
    expect(NOTIFICATION_CATEGORIES.every((c) => CATEGORY_INFO[c].label.length > 0)).toBe(true);
  });
});
