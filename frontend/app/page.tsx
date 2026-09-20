"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HealthPanel } from "./components/health-panel";
import { OffersTable } from "./components/offers-table";
import { SearchForm } from "./components/search-form";
import {
  buildQuery,
  fetchHealth,
  readSearchParams,
  searchHotels,
  type HealthReport,
  type HotelSearch,
  type SearchResult,
} from "@/lib/hotels";

const SCENARIOS = [
  { label: "delhi — overlapping suppliers", query: "city=delhi" },
  { label: "delhi — price 4000–6000", query: "city=delhi&minPrice=4000&maxPrice=6000" },
  { label: "atlantis — no results", query: "city=atlantis" },
];

export default function Page() {
  return (
    // useSearchParams needs a Suspense boundary in a statically exported page.
    <Suspense fallback={null}>
      <Orchestrator />
    </Suspense>
  );
}

function Orchestrator() {
  const router = useRouter();
  const params = useSearchParams();
  const search = readSearchParams(params);
  const query = buildQuery(search);

  const [result, setResult] = useState<SearchResult | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [healthLoaded, setHealthLoaded] = useState(false);

  const refreshHealth = useCallback(async () => {
    setHealth(await fetchHealth());
    setHealthLoaded(true);
  }, []);

  // Re-runs whenever the query string changes, which is what the form and the
  // scenario links do — the URL stays the single source of truth.
  useEffect(() => {
    let live = true;
    setResult(null);
    searchHotels(readSearchParams(new URLSearchParams(query))).then((next) => {
      if (live) setResult(next);
    });
    return () => {
      live = false;
    };
  }, [query]);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  const onSearch = (next: HotelSearch) => router.push(`/?${buildQuery(next)}`);

  const onSupplierChanged = useCallback(() => {
    void refreshHealth();
    // Availability changed, so the cached aggregate was dropped: re-run the search.
    searchHotels(readSearchParams(new URLSearchParams(query))).then(setResult);
  }, [query, refreshHealth]);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-16">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Hotel Offer Orchestrator</h1>
        <p className="mt-1.5 text-sm opacity-60">
          Two suppliers, queried in parallel by a Temporal workflow. Cheapest offer per hotel wins;
          price filtering runs inside Redis.
        </p>
      </header>

      {healthLoaded ? (
        <HealthPanel health={health} onChanged={onSupplierChanged} />
      ) : (
        <p className="text-sm opacity-60">Checking dependencies…</p>
      )}

      <div className="mt-8">
        <SearchForm search={search} onSubmit={onSearch} />
        <nav className="mt-3 flex flex-wrap gap-2 text-xs" aria-label="Example scenarios">
          {SCENARIOS.map((scenario) => (
            <a
              key={scenario.query}
              href={`/?${scenario.query}`}
              className="rounded-full border border-black/15 px-2.5 py-1 opacity-70 transition-opacity hover:opacity-100 dark:border-white/20"
            >
              {scenario.label}
            </a>
          ))}
        </nav>
      </div>

      <section className="mt-10">
        <Results search={search} result={result} />
      </section>
    </main>
  );
}

function Results({ search, result }: { search: HotelSearch; result: SearchResult | null }) {
  if (result === null) return <p className="text-sm opacity-60">Orchestrating…</p>;

  if (!result.ok) {
    return (
      <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/5 p-4 text-sm text-red-600 dark:text-red-400">
        {result.error}
      </p>
    );
  }

  return (
    <>
      {result.degraded.length > 0 && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400"
        >
          <strong className="font-medium">Partial results.</strong> {result.degraded.join(" and ")} could not
          be reached, so prices come from the remaining supplier only.
        </p>
      )}

      <p className="mb-3 text-xs uppercase tracking-wide opacity-50">
        {result.offers.length} hotel{result.offers.length === 1 ? "" : "s"} in {search.city}
        {" · "}
        {result.cached ? "served from Redis cache" : "freshly orchestrated"}
      </p>
      <OffersTable offers={result.offers} />
    </>
  );
}
