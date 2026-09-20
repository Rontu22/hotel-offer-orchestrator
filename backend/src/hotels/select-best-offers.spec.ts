import { describe, expect, it } from 'vitest';
import type { SupplierHotel } from '../suppliers/supplier.types.js';
import { partitionFeeds, selectBestOffers } from './select-best-offers.js';

const hotel = (over: Partial<SupplierHotel>): SupplierHotel => ({
  hotelId: 'x',
  name: 'Holtin',
  price: 1000,
  city: 'delhi',
  commissionPct: 10,
  ...over,
});

describe('selectBestOffers', () => {
  it('keeps the cheaper offer when both suppliers list the hotel', () => {
    const offers = selectBestOffers([
      { supplier: 'Supplier A', hotels: [hotel({ price: 6000, commissionPct: 10 })] },
      { supplier: 'Supplier B', hotels: [hotel({ price: 5340, commissionPct: 20 })] },
    ]);

    expect(offers).toEqual([
      { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 },
    ]);
  });

  it('keeps the only offer when a hotel comes from one supplier', () => {
    const offers = selectBestOffers([
      { supplier: 'Supplier A', hotels: [hotel({ name: 'Tajmahal Palace', price: 12400 })] },
      { supplier: 'Supplier B', hotels: [] },
    ]);

    expect(offers.map((o) => o.supplier)).toEqual(['Supplier A']);
  });

  it('breaks price ties by feed order, not by which supplier replied first', () => {
    const feeds = [
      { supplier: 'Supplier A' as const, hotels: [hotel({ price: 9100 })] },
      { supplier: 'Supplier B' as const, hotels: [hotel({ price: 9100 })] },
    ];

    expect(selectBestOffers(feeds)[0].supplier).toBe('Supplier A');
  });

  it('treats differently cased names as the same hotel and trims them', () => {
    const offers = selectBestOffers([
      { supplier: 'Supplier A', hotels: [hotel({ name: ' holtin ', price: 7000 })] },
      { supplier: 'Supplier B', hotels: [hotel({ name: 'HOLTIN', price: 6000 })] },
    ]);

    expect(offers).toHaveLength(1);
    expect(offers[0].name).toBe('HOLTIN');
  });

  it('sorts by price ascending, then by name', () => {
    const offers = selectBestOffers([
      {
        supplier: 'Supplier A',
        hotels: [
          hotel({ name: 'Zeta', price: 100 }),
          hotel({ name: 'Alpha', price: 100 }),
          hotel({ name: 'Cheap', price: 50 }),
        ],
      },
    ]);

    expect(offers.map((o) => o.name)).toEqual(['Cheap', 'Alpha', 'Zeta']);
  });

  it('returns nothing when no supplier knows the city', () => {
    expect(selectBestOffers([{ supplier: 'Supplier A', hotels: [] }])).toEqual([]);
  });
});

describe('partitionFeeds', () => {
  const ok = (hotels: SupplierHotel[]) => ({ status: 'fulfilled', value: hotels }) as const;
  const failed = (reason: unknown) => ({ status: 'rejected', reason }) as const;

  it('keeps every feed when both suppliers answer', () => {
    const { feeds, degraded, failures } = partitionFeeds([
      { supplier: 'Supplier A', result: ok([hotel({})]) },
      { supplier: 'Supplier B', result: ok([hotel({})]) },
    ]);

    expect(feeds.map((f) => f.supplier)).toEqual(['Supplier A', 'Supplier B']);
    expect(degraded).toEqual([]);
    expect(failures).toEqual([]);
  });

  it('degrades to the surviving supplier and records why the other failed', () => {
    const { feeds, degraded, failures } = partitionFeeds([
      { supplier: 'Supplier A', result: failed(new Error('Supplier A responded 503')) },
      { supplier: 'Supplier B', result: ok([hotel({})]) },
    ]);

    expect(feeds.map((f) => f.supplier)).toEqual(['Supplier B']);
    expect(degraded).toEqual(['Supplier A']);
    expect(failures).toEqual([{ supplier: 'Supplier A', reason: 'Supplier A responded 503' }]);
  });

  it('reports no usable feeds when both suppliers fail', () => {
    const { feeds, degraded } = partitionFeeds([
      { supplier: 'Supplier A', result: failed(new Error('down')) },
      { supplier: 'Supplier B', result: failed(new Error('down')) },
    ]);

    expect(feeds).toEqual([]);
    expect(degraded).toEqual(['Supplier A', 'Supplier B']);
  });

  it('describes a non-Error rejection without throwing', () => {
    const { failures } = partitionFeeds([{ supplier: 'Supplier A', result: failed('boom') }]);
    expect(failures[0].reason).toBe('boom');
  });

  it('unwraps the real reason out of Temporal\'s ActivityFailure wrapper', () => {
    const wrapped = new Error('Activity task failed', {
      cause: new Error('Supplier A responded 503'),
    });

    const { failures } = partitionFeeds([{ supplier: 'Supplier A', result: failed(wrapped) }]);
    expect(failures[0].reason).toBe('Supplier A responded 503');
  });

  it('survives a self-referencing cause chain', () => {
    const looped = new Error('outer');
    looped.cause = looped;

    expect(partitionFeeds([{ supplier: 'Supplier A', result: failed(looped) }]).failures[0].reason).toBe('outer');
  });
});
