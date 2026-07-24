export type ConcurrencyMapResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

export async function mapWithConcurrency<TItem, TResult>(
  items: TItem[],
  limit: number,
  mapper: (item: TItem, index: number) => Promise<TResult>,
): Promise<Array<ConcurrencyMapResult<TResult>>> {
  if (items.length === 0) {
    return [];
  }

  const concurrency = Math.max(1, Math.min(limit, items.length));
  const results = new Array<ConcurrencyMapResult<TResult>>(items.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;

        if (currentIndex >= items.length) {
          return;
        }

        try {
          results[currentIndex] = {
            ok: true,
            value: await mapper(items[currentIndex], currentIndex),
          };
        } catch (error) {
          results[currentIndex] = {
            ok: false,
            error,
          };
        }
      }
    }),
  );

  return results;
}
