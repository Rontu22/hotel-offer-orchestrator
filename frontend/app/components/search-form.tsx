"use client";

import { DEFAULT_CITY, type HotelSearch } from "@/lib/hotels";

const field = "w-full rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500";
const label = "block text-xs font-medium uppercase tracking-wide opacity-60 mb-1.5";

/**
 * A plain GET form: the query string stays the state, so results are shareable and
 * back/forward works. The page intercepts submit to update the URL without a reload.
 */
export function SearchForm({ search, onSubmit }: { search: HotelSearch; onSubmit: (next: HotelSearch) => void }) {
  return (
    <form
      className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onSubmit({
          city: String(data.get("city") ?? "").trim() || DEFAULT_CITY,
          minPrice: String(data.get("minPrice") ?? "").trim() || undefined,
          maxPrice: String(data.get("maxPrice") ?? "").trim() || undefined,
        });
      }}
    >
      <div>
        <label className={label} htmlFor="city">City</label>
        <input id="city" name="city" key={search.city} defaultValue={search.city} placeholder={DEFAULT_CITY} required className={field} />
      </div>
      <div>
        <label className={label} htmlFor="minPrice">Min price</label>
        <input id="minPrice" name="minPrice" key={`min-${search.minPrice}`} type="number" min={0} step={1} defaultValue={search.minPrice ?? ""} placeholder="any" className={field} />
      </div>
      <div>
        <label className={label} htmlFor="maxPrice">Max price</label>
        <input id="maxPrice" name="maxPrice" key={`max-${search.maxPrice}`} type="number" min={0} step={1} defaultValue={search.maxPrice ?? ""} placeholder="any" className={field} />
      </div>
      <button
        type="submit"
        className="rounded-md bg-foreground px-5 py-2 text-sm font-medium text-background transition duration-100 hover:opacity-85 active:scale-[0.97] active:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 motion-reduce:active:scale-100"
      >
        Search
      </button>
    </form>
  );
}
