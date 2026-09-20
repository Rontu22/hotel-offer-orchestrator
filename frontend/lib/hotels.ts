export interface HotelOffer {
  name: string;
  price: number;
  supplier: string;
  commissionPct: number;
}

export interface HotelSearch {
  city: string;
  minPrice?: string;
  maxPrice?: string;
}

export const DEFAULT_CITY = "delhi";
export const SUPPLIER_IDS = ["supplierA", "supplierB"] as const;
export type SupplierId = (typeof SUPPLIER_IDS)[number];

/**
 * Empty means same-origin, which is how production works: CloudFront serves the
 * static bundle and routes /api, /health and /supplier* to the EC2 origin, so the
 * browser never makes a cross-origin request. Set it for `next dev` against a
 * local API on another port.
 */
export const apiBaseUrl = (): string => process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

/** Search params arrive as string | string[] | undefined; flatten and trim them. */
export function readSearch(params: Record<string, string | string[] | undefined>): HotelSearch {
  const one = (value: string | string[] | undefined): string | undefined => {
    const first = Array.isArray(value) ? value[0] : value;
    const trimmed = first?.trim();
    return trimmed ? trimmed : undefined;
  };

  return {
    city: one(params.city) ?? DEFAULT_CITY,
    minPrice: one(params.minPrice),
    maxPrice: one(params.maxPrice),
  };
}

/** Same as readSearch, for the URLSearchParams the browser gives us. */
export function readSearchParams(params: URLSearchParams): HotelSearch {
  return readSearch(Object.fromEntries(params.entries()));
}

export function buildQuery({ city, minPrice, maxPrice }: HotelSearch): string {
  const query = new URLSearchParams({ city });
  if (minPrice) query.set("minPrice", minPrice);
  if (maxPrice) query.set("maxPrice", maxPrice);
  return query.toString();
}

export type SearchResult =
  | { ok: true; offers: HotelOffer[]; cached: boolean; degraded: string[] }
  | { ok: false; error: string };

export async function searchHotels(search: HotelSearch): Promise<SearchResult> {
  try {
    const response = await fetch(`${apiBaseUrl()}/api/hotels?${buildQuery(search)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      return { ok: false, error: body?.message ?? `API responded ${response.status}` };
    }

    return {
      ok: true,
      offers: (await response.json()) as HotelOffer[],
      cached: response.headers.get("x-cache") === "HIT",
      degraded: parseDegraded(response.headers.get("x-degraded-suppliers")),
    };
  } catch {
    return { ok: false, error: "Could not reach the orchestrator API." };
  }
}

export function parseDegraded(header: string | null): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

export interface Check {
  status: "up" | "down";
  latencyMs: number;
  error?: string;
}

export interface HealthReport {
  status: "ok" | "degraded" | "unhealthy";
  checkedAt: string;
  redis: Check;
  temporal: Check;
  suppliers: Record<SupplierId, Check>;
}

export async function fetchHealth(): Promise<HealthReport | null> {
  try {
    const response = await fetch(`${apiBaseUrl()}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    // A 503 still carries the full report, and that is exactly what we want to show.
    return (await response.json()) as HealthReport;
  } catch {
    return null;
  }
}

/** Flips a mock supplier's availability so the degraded path can be demonstrated. */
export async function setSupplierAvailability(supplier: SupplierId, available: boolean): Promise<void> {
  const response = await fetch(`${apiBaseUrl()}/api/suppliers/${supplier}/availability`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ available }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Could not update ${supplier}: ${response.status}`);
}
