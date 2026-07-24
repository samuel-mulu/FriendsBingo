import { mapWithConcurrency } from './map-with-concurrency';

describe('mapWithConcurrency', () => {
  it('respects the configured concurrency limit', async () => {
    let active = 0;
    let maxActive = 0;

    const results = await mapWithConcurrency(
      [1, 2, 3, 4, 5],
      2,
      async (value) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return value * 10;
      },
    );

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(results).toEqual([
      { ok: true, value: 10 },
      { ok: true, value: 20 },
      { ok: true, value: 30 },
      { ok: true, value: 40 },
      { ok: true, value: 50 },
    ]);
  });

  it('continues processing after an item fails', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, (value) => {
      if (value === 2) {
        return Promise.reject(new Error('boom'));
      }
      return Promise.resolve(value);
    });

    expect(results[0]).toEqual({ ok: true, value: 1 });
    expect(results[1].ok).toBe(false);
    expect(results[2]).toEqual({ ok: true, value: 3 });
  });
});
