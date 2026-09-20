export const SUPPLIERS = ['Supplier A', 'Supplier B'] as const;
export type SupplierName = (typeof SUPPLIERS)[number];

/** URL/slug form of a supplier, as used by the supplier services and the admin API. */
export const SUPPLIER_IDS = ['supplierA', 'supplierB'] as const;
export type SupplierId = (typeof SUPPLIER_IDS)[number];

export const SUPPLIER_NAMES: Record<SupplierId, SupplierName> = {
  supplierA: 'Supplier A',
  supplierB: 'Supplier B',
};

/** Which env var holds each supplier's base URL. Keeps the lookup in one place. */
export const SUPPLIER_URL_ENV = {
  supplierA: 'SUPPLIER_A_URL',
  supplierB: 'SUPPLIER_B_URL',
} as const satisfies Record<SupplierId, string>;

export function isSupplierId(value: string): value is SupplierId {
  return (SUPPLIER_IDS as readonly string[]).includes(value);
}

/** Shape returned by the supplier services' GET /hotels. */
export interface SupplierHotel {
  hotelId: string;
  name: string;
  price: number;
  city: string;
  commissionPct: number;
}
