import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupplierAvailabilityService } from './supplier-availability.service.js';

const URLS = { SUPPLIER_A_URL: 'http://supplier-a:4002', SUPPLIER_B_URL: 'http://supplier-b:4003' };

/**
 * Stands in for the two supplier services: each keeps its own flag, so the test
 * proves we address them separately rather than sharing one piece of state.
 */
function stubSuppliers(unreachable: string[] = []) {
  const available: Record<string, boolean> = { '4002': true, '4003': true };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const port = new URL(url).port;
      if (unreachable.includes(port)) throw new TypeError('fetch failed');
      if (init?.method === 'PUT') available[port] = JSON.parse(String(init.body)).available;
      return Response.json({ available: available[port] });
    }),
  );
  return available;
}

describe('SupplierAvailabilityService', () => {
  let availability: SupplierAvailabilityService;

  beforeEach(() => {
    vi.unstubAllGlobals();
    availability = new SupplierAvailabilityService(new ConfigService(URLS) as never);
  });

  it('treats both suppliers as available until told otherwise', async () => {
    stubSuppliers();
    expect(await availability.list()).toEqual({ supplierA: true, supplierB: true });
  });

  it('takes a single supplier down without touching the other', async () => {
    stubSuppliers();
    await availability.set('supplierA', false);

    expect(await availability.list()).toEqual({ supplierA: false, supplierB: true });
  });

  it('brings a supplier back up again, and is idempotent', async () => {
    stubSuppliers();
    await availability.set('supplierB', false);
    await availability.set('supplierB', false);
    await availability.set('supplierB', true);

    expect(await availability.list()).toEqual({ supplierA: true, supplierB: true });
  });

  it('reports an unreachable supplier as down rather than failing the read', async () => {
    stubSuppliers(['4002']);
    expect(await availability.list()).toEqual({ supplierA: false, supplierB: true });
  });

  it('refuses to claim success when the supplier cannot be reached', async () => {
    stubSuppliers(['4002']);
    await expect(availability.set('supplierA', false)).rejects.toThrow(ServiceUnavailableException);
  });
});
