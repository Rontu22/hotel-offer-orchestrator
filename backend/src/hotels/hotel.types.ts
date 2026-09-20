import type { SupplierName } from '../suppliers/supplier.types.js';

/** The client-facing offer: one per hotel name, cheapest supplier wins. */
export interface HotelOffer {
  name: string;
  price: number;
  supplier: SupplierName;
  commissionPct: number;
}

export interface PriceRange {
  minPrice?: number;
  maxPrice?: number;
}

/** What the workflow produced, and what it could not reach while producing it. */
export interface AggregateResult {
  offers: HotelOffer[];
  degraded: SupplierName[];
}

