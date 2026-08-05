import { vi } from "vitest";

/**
 * WP81 test harness — a fake `Vault.adapter` whose `append` can be made to
 * reject on demand.
 *
 * A live vault path is never made unwritable to produce a write failure; the
 * failure is injected here, at the adapter seam, exactly as
 * `debug-logger.test.ts` already injects the success path.
 */
export interface FakeAdapter {
  /** Every append that RESOLVED, in order: the lines that really landed. */
  written: Array<{ path: string; text: string }>;
  /** Every append that was ATTEMPTED, resolved or not. */
  attempted: Array<{ path: string; text: string }>;
  /** Flip to make the next appends reject. */
  failing: boolean;
  /** Message the rejection carries. */
  failWith: string;
  /** Resolvers for appends deliberately held open (in-flight tests). */
  release: Array<() => void>;
  /** Hold the next append open instead of settling it. */
  hold: boolean;
}

export interface FakeVault {
  adapter: {
    append: (path: string, text: string) => Promise<void>;
  };
  fake: FakeAdapter;
}

export function makeVault(): FakeVault {
  const fake: FakeAdapter = {
    written: [],
    attempted: [],
    failing: false,
    failWith: "EACCES: permission denied",
    release: [],
    hold: false,
  };

  const append = vi.fn((path: string, text: string): Promise<void> => {
    fake.attempted.push({ path, text });
    if (fake.hold) {
      return new Promise<void>((resolve, reject) => {
        fake.release.push(() => {
          if (fake.failing) reject(new Error(fake.failWith));
          else {
            fake.written.push({ path, text });
            resolve();
          }
        });
      });
    }
    if (fake.failing) return Promise.reject(new Error(fake.failWith));
    fake.written.push({ path, text });
    return Promise.resolve();
  });

  return { adapter: { append }, fake } as unknown as FakeVault;
}

/**
 * Let queued microtasks run so a `Promise` rejection has actually been
 * DELIVERED before anything is asserted.
 *
 * This matters: the naive "the lines are still buffered" assertion, made
 * synchronously right after `flush()`, passes against the unrepaired
 * `flush()` body too, because the rejection has not been delivered yet.
 */
export async function settle(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

/** Every line that actually landed in the log file, flattened. */
export function writtenLines(v: FakeVault): string[] {
  return v.fake.written.flatMap((w) => w.text.split("\n")).filter((line) => line.trim().length > 0);
}
