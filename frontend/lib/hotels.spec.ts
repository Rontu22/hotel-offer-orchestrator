import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CITY, buildQuery, fetchHealth, parseDegraded, readSearch, searchHotels } from "./hotels";

describe("readSearch", () => {
  it("falls back to the default city when none is given", () => {
    expect(readSearch({})).toEqual({ city: DEFAULT_CITY, minPrice: undefined, maxPrice: undefined });
  });

  it("treats blank and whitespace-only values as absent", () => {
    expect(readSearch({ city: "  ", minPrice: "", maxPrice: " " })).toEqual({
      city: DEFAULT_CITY,
      minPrice: undefined,
      maxPrice: undefined,
    });
  });

  it("takes the first value when a param is repeated", () => {
    expect(readSearch({ city: ["mumbai", "delhi"] }).city).toBe("mumbai");
  });
});

describe("buildQuery", () => {
  it("omits price bounds that were not supplied", () => {
    expect(buildQuery({ city: "delhi" })).toBe("city=delhi");
  });

  it("includes both bounds and escapes the city", () => {
    expect(buildQuery({ city: "new delhi", minPrice: "4000", maxPrice: "6000" })).toBe(
      "city=new+delhi&minPrice=4000&maxPrice=6000",
    );
  });
});

describe("searchHotels", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports the cache header alongside the offers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([]))),
    );

    await expect(searchHotels({ city: "delhi" })).resolves.toEqual({
      ok: true,
      offers: [],
      degraded: [],
    });
  });

  it("surfaces which suppliers were unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { headers: { "x-degraded-suppliers": "Supplier A" } })),
    );

    const result = await searchHotels({ city: "delhi" });
    expect(result).toMatchObject({ ok: true, degraded: ["Supplier A"] });
  });

  it("surfaces the API error message instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "city is required" }), { status: 400 })),
    );

    expect(await searchHotels({ city: "" })).toEqual({ ok: false, error: "city is required" });
  });

  it("degrades to a readable error when the API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));

    expect(await searchHotels({ city: "delhi" })).toEqual({
      ok: false,
      error: "Could not reach the orchestrator API.",
    });
  });
});

describe("parseDegraded", () => {
  it("returns nothing when the header is absent", () => {
    expect(parseDegraded(null)).toEqual([]);
    expect(parseDegraded("")).toEqual([]);
  });

  it("splits and trims a multi-supplier header", () => {
    expect(parseDegraded("Supplier A, Supplier B")).toEqual(["Supplier A", "Supplier B"]);
  });
});

describe("fetchHealth", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the report from a 503 response, since it carries the detail", async () => {
    const report = { status: "unhealthy", redis: { status: "down", latencyMs: 1 } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(report), { status: 503 })));

    expect(await fetchHealth()).toMatchObject({ status: "unhealthy" });
  });

  it("returns null when the API cannot be reached at all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    expect(await fetchHealth()).toBeNull();
  });
});
