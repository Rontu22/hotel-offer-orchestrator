import type { ConfigService } from '@nestjs/config';

/** Fail fast on boot instead of at the first request. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const num = (key: string, fallback: number): number => {
    const value = raw[key];
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`${key} must be a number, got "${String(value)}"`);
    return parsed;
  };
  const bool = (key: string, fallback: boolean): boolean => {
    const value = raw[key];
    if (value === undefined || value === '') return fallback;
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    throw new Error(`${key} must be true or false, got "${String(value)}"`);
  };
  const str = (key: string, fallback?: string): string => {
    const value = raw[key];
    if (typeof value === 'string' && value !== '') return value;
    if (fallback !== undefined) return fallback;
    throw new Error(`${key} is required`);
  };

  return {
    NODE_ENV: str('NODE_ENV', 'development'),
    PORT: num('PORT', 3001),
    REDIS_URL: str('REDIS_URL', 'redis://localhost:6379'),
    CACHE_TTL_SECONDS: num('CACHE_TTL_SECONDS', 300),
    TEMPORAL_ADDRESS: str('TEMPORAL_ADDRESS', 'localhost:7233'),
    TEMPORAL_NAMESPACE: str('TEMPORAL_NAMESPACE', 'default'),
    TEMPORAL_TASK_QUEUE: str('TEMPORAL_TASK_QUEUE', 'hotel-offers'),
    SUPPLIER_A_URL: str('SUPPLIER_A_URL', 'http://localhost:4002'),
    SUPPLIER_B_URL: str('SUPPLIER_B_URL', 'http://localhost:4003'),
    ENABLE_FAULT_INJECTION: bool('ENABLE_FAULT_INJECTION', true),
    HEALTH_PROBE_TIMEOUT_MS: num('HEALTH_PROBE_TIMEOUT_MS', 5000),
  };
}

export interface Env {
  NODE_ENV: string;
  PORT: number;
  REDIS_URL: string;
  CACHE_TTL_SECONDS: number;
  TEMPORAL_ADDRESS: string;
  TEMPORAL_NAMESPACE: string;
  TEMPORAL_TASK_QUEUE: string;
  /** Base URLs of the two standalone supplier services. They own their own databases. */
  SUPPLIER_A_URL: string;
  SUPPLIER_B_URL: string;
  /** Allows the runtime supplier kill switch. Turn off for a real deployment. */
  ENABLE_FAULT_INJECTION: boolean;
  /**
   * Per-dependency budget in /health, matched to the activity's own 5s fetch
   * timeout: a supplier the workflow can still use must not be reported down.
   * The suppliers add SUPPLIER_LATENCY_MS on purpose, so a tighter budget turns
   * an ordinary load spike into a false outage.
   */
  HEALTH_PROBE_TIMEOUT_MS: number;
}

export type TypedConfig = ConfigService<Env, true>;
