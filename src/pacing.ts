export interface PacingOptions {
  betweenRoundsMs?: number;
  betweenPeersMs?: number;
  perEventMs?: number;
}

const DEFAULTS = {
  betweenRoundsMs: 0,
  betweenPeersMs: 0,
  perEventMs: 0,
} as const;

export class Pacer {
  private readonly options: Required<PacingOptions>;

  constructor(options: PacingOptions = {}) {
    this.options = {
      betweenRoundsMs: clamp(options.betweenRoundsMs ?? DEFAULTS.betweenRoundsMs),
      betweenPeersMs: clamp(options.betweenPeersMs ?? DEFAULTS.betweenPeersMs),
      perEventMs: clamp(options.perEventMs ?? DEFAULTS.perEventMs),
    };
  }

  betweenRounds(): Promise<void> {
    return sleep(this.options.betweenRoundsMs);
  }

  betweenPeers(): Promise<void> {
    return sleep(this.options.betweenPeersMs);
  }

  perEvent(): Promise<void> {
    return sleep(this.options.perEventMs);
  }
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(value, 30_000);
}

export function pacingFromFlag(flag: string | number | undefined): Pacer {
  if (flag === undefined || flag === "") {
    return new Pacer();
  }

  if (typeof flag === "number") {
    return new Pacer({ betweenRoundsMs: flag, betweenPeersMs: flag, perEventMs: Math.min(flag / 3, 400) });
  }

  if (flag === "demo") {
    return new Pacer({ betweenRoundsMs: 1400, betweenPeersMs: 700, perEventMs: 250 });
  }

  if (flag === "slow") {
    return new Pacer({ betweenRoundsMs: 2400, betweenPeersMs: 1200, perEventMs: 400 });
  }

  const numeric = Number(flag);
  if (Number.isFinite(numeric)) {
    return pacingFromFlag(numeric);
  }
  return new Pacer();
}
