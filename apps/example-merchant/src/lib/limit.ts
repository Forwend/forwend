/** At most max hits per key in each window. wait says how many seconds until a key may hit again, 0 if now, and
 * changes nothing; hit counts one. ponytail: counts live in this process; a shop on several servers shares them. */
export function limiter(max: number, windowMs: number) {
  const windows = new Map<string, { count: number; resetAt: number }>();
  const live = (key: string, now: number) => {
    const w = windows.get(key);
    return w && w.resetAt > now ? w : undefined;
  };
  return {
    wait(key: string, now = Date.now()): number {
      const w = live(key, now);
      return w && w.count >= max ? Math.ceil((w.resetAt - now) / 1000) : 0;
    },
    hit(key: string, now = Date.now()): void {
      for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
      const w = live(key, now) ?? { count: 0, resetAt: now + windowMs };
      w.count++;
      windows.set(key, w);
    },
  };
}
