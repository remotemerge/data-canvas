/**
 * Compares a recorded benchmark run against the stored baseline.
 *
 * Relative rather than absolute. Absolute timings are device-dependent — a run on a laptop on
 * battery and the same run on a workstation differ by more than most regressions do — so a fixed
 * millisecond threshold would either fire constantly or never. Comparing each tier against its own
 * previously recorded value on the same device profile is the only threshold that means anything.
 *
 * Usage:
 *
 *   bun run tests/performance/regression-report.ts --record run.json   # replace the baseline
 *   bun run tests/performance/regression-report.ts run.json            # compare against it
 *
 * `run.json` is the output of `window.__dataCanvas.perf()`, saved from a browser session after
 * working through the benchmark tiers in `docs/performance.md`.
 */

/** One measurement from the in-app performance marks. */
export interface PerformanceRecord {
  name: string;
  durationMs?: number;
  rowsReturned?: number;
  recordedAt: string;
}

export interface TierMeasurement {
  /** Median duration across the tier's samples. Median rather than mean: one GC pause is not a trend. */
  medianMs: number;
  samples: number;
  maxRowsReturned: number;
}

export interface Baseline {
  schemaVersion: number;
  /** Build the baseline was recorded from. A comparison across builds is expected; across devices is not. */
  buildSha: string | null;
  /** Free-text device profile, e.g. "M2 Pro / Chrome 141". Comparisons across profiles are meaningless. */
  device: string | null;
  recordedAt: string | null;
  tiers: Record<string, TierMeasurement>;
}

export const BASELINE_SCHEMA_VERSION = 1;

/**
 * Relative regression threshold.
 *
 * 20% because run-to-run variance on a browser benchmark routinely reaches 10% even on an idle
 * machine; a tighter gate would report noise as regression and get ignored, which is worse than no
 * gate at all.
 */
export const REGRESSION_THRESHOLD = 0.2;

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;

  const sorted = [...values].toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
    : (sorted[middle] as number);
};

/** Groups raw records into one measurement per named tier. */
export const summarize = (records: readonly PerformanceRecord[]): Record<string, TierMeasurement> => {
  const durations = new Map<string, number[]>();
  const rows = new Map<string, number>();

  for (const record of records) {
    if (record.durationMs !== undefined) {
      const bucket = durations.get(record.name) ?? [];

      bucket.push(record.durationMs);
      durations.set(record.name, bucket);
    }

    if (record.rowsReturned !== undefined) {
      rows.set(record.name, Math.max(rows.get(record.name) ?? 0, record.rowsReturned));
    }
  }

  const tiers: Record<string, TierMeasurement> = {};

  for (const name of new Set([...durations.keys(), ...rows.keys()])) {
    const samples = durations.get(name) ?? [];

    tiers[name] = {
      medianMs: median(samples),
      samples: samples.length,
      maxRowsReturned: rows.get(name) ?? 0,
    };
  }

  return tiers;
};

export interface Regression {
  tier: string;
  baselineMs: number;
  currentMs: number;
  /** Fractional change; 0.35 means 35% slower than baseline. */
  change: number;
}

/**
 * Reports tiers that regressed beyond the threshold.
 *
 * A tier absent from the baseline is not a regression — it is new, and reporting it would make
 * adding a benchmark look like breaking one. A tier absent from the current run is also skipped:
 * that means the run did not cover it, which is a gap in the run rather than a slowdown.
 */
export const findRegressions = (
  baseline: Readonly<Record<string, TierMeasurement>>,
  current: Readonly<Record<string, TierMeasurement>>,
  threshold: number = REGRESSION_THRESHOLD,
): Regression[] => {
  const regressions: Regression[] = [];

  for (const [tier, measurement] of Object.entries(current)) {
    const previous = baseline[tier];

    if (previous === undefined || previous.medianMs <= 0) continue;

    const change = (measurement.medianMs - previous.medianMs) / previous.medianMs;

    if (change > threshold) {
      regressions.push({ tier, baselineMs: previous.medianMs, currentMs: measurement.medianMs, change });
    }
  }

  return regressions.toSorted((left, right) => right.change - left.change);
};

export const formatReport = (regressions: readonly Regression[], comparedTiers: number): string => {
  if (comparedTiers === 0) {
    return 'No baseline tiers to compare against. Record one with --record before expecting a comparison.';
  }

  if (regressions.length === 0) return `No regressions across ${comparedTiers} tier(s).`;

  const lines = regressions.map(
    (entry) =>
      `  ${entry.tier}: ${entry.baselineMs.toFixed(1)}ms → ${entry.currentMs.toFixed(1)}ms (+${(entry.change * 100).toFixed(0)}%)`,
  );

  return [`${regressions.length} regression(s) beyond ${(REGRESSION_THRESHOLD * 100).toFixed(0)}%:`, ...lines].join(
    '\n',
  );
};

// The CLI runs only when this file is the entry point, so importing it from a test does no I/O.
if (import.meta.main) {
  const BASELINE_PATH = 'tests/performance/baseline.json';
  const args = Bun.argv.slice(2);
  const recording = args.includes('--record');
  const runPath = args.find((argument) => !argument.startsWith('--'));

  if (runPath === undefined) {
    throw new Error('Pass the path to a saved window.__dataCanvas.perf() JSON file.');
  }

  const records = (await Bun.file(runPath).json()) as PerformanceRecord[];
  const tiers = summarize(records);
  const deviceProfile = Bun.env['DC_DEVICE_PROFILE'];

  if (recording) {
    const baseline: Baseline = {
      schemaVersion: BASELINE_SCHEMA_VERSION,
      buildSha: Bun.env['GITHUB_SHA'] ?? null,
      device: deviceProfile ?? null,
      recordedAt: new Date().toISOString(),
      tiers,
    };

    await Bun.write(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    // eslint-disable-next-line no-console -- a CLI reports where it wrote.
    console.log(`Recorded ${Object.keys(tiers).length} tier(s) to ${BASELINE_PATH}`);
  } else {
    const baseline = (await Bun.file(BASELINE_PATH).json()) as Baseline;
    const regressions = findRegressions(baseline.tiers ?? {}, tiers);

    if (baseline.device !== null && deviceProfile !== undefined && baseline.device !== deviceProfile) {
      // eslint-disable-next-line no-console -- a CLI warns about an invalid comparison.
      console.warn(`Baseline was recorded on '${baseline.device}'; comparing across devices is not meaningful.`);
    }

    // eslint-disable-next-line no-console -- a CLI prints its report.
    console.log(formatReport(regressions, Object.keys(baseline.tiers ?? {}).length));

    if (regressions.length > 0) process.exit(1);
  }
}
