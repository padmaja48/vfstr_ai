import { RequestHandler } from 'express';

export type ConcurrencyGateOptions = {
  /** Max handlers running at once for this gate. */
  maxConcurrent: number;
  /** Extra requests allowed to wait. Overflow gets 503 + retryable. */
  maxQueue?: number;
  /** Seconds suggested to the client via Retry-After. */
  retryAfterSeconds?: number;
  code?: string;
  message?: string;
};

/**
 * Backpressure for expensive interview start/create paths (J01).
 * When saturated, returns 503 with retryable: true instead of crashing the process.
 */
export const concurrencyGate = (options: ConcurrencyGateOptions): RequestHandler => {
  const maxConcurrent = Math.max(1, options.maxConcurrent);
  const maxQueue = Math.max(0, options.maxQueue ?? 0);
  const retryAfterSeconds = options.retryAfterSeconds ?? 2;
  const code = options.code ?? 'SERVICE_BUSY';
  const message =
    options.message ?? 'Interview service is busy. Please retry in a moment.';

  let active = 0;
  const waiters: Array<() => void> = [];

  const tryAdmit = (): boolean => {
    if (active < maxConcurrent) {
      active += 1;
      return true;
    }
    return false;
  };

  const release = () => {
    active = Math.max(0, active - 1);
    const next = waiters.shift();
    if (next) {
      active += 1;
      next();
    }
  };

  return (req, res, next) => {
    if (tryAdmit()) {
      let released = false;
      const onceRelease = () => {
        if (released) return;
        released = true;
        release();
      };
      res.on('finish', onceRelease);
      res.on('close', onceRelease);
      next();
      return;
    }

    if (waiters.length >= maxQueue) {
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(503).json({
        error: message,
        message,
        code,
        retryable: true,
      });
      return;
    }

    waiters.push(() => {
      let released = false;
      const onceRelease = () => {
        if (released) return;
        released = true;
        release();
      };
      res.on('finish', onceRelease);
      res.on('close', onceRelease);
      next();
    });
  };
};

/** Defaults tuned for up to 50 concurrent create/start calls plus a short queue. */
export const interviewStartGate = concurrencyGate({
  maxConcurrent: Number(process.env.INTERVIEW_START_MAX_CONCURRENT || 50),
  maxQueue: Number(process.env.INTERVIEW_START_MAX_QUEUE || 10),
  retryAfterSeconds: 2,
  code: 'INTERVIEW_START_BUSY',
  message: 'Too many interviews starting at once. Please retry in a moment.',
});
