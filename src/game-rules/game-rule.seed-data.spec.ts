import { seededGameRules } from './game-rule.seed-data';

describe('seededGameRules', () => {
  it('includes an active MANUAL rule for MVP seeding', () => {
    const manualRule = seededGameRules.find((rule) => rule.key === 'MANUAL');

    expect(manualRule).toBeDefined();
    expect(manualRule?.isActive).toBe(true);
    expect(manualRule?.sortOrder).toBe(1);
  });
});
