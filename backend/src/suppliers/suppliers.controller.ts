import { Controller, Get, Query, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { SUPPLIER_URL_ENV, type SupplierHotel, type SupplierId } from './supplier.types.js';

/**
 * The supplier paths the brief pins down, mounted outside /api so they read as
 * third-party services. Each one forwards to the standalone supplier that owns
 * the data — this service holds no catalogue of its own and no credentials for
 * their databases, so the only way to answer is to ask them over HTTP.
 */
@Controller()
export class SuppliersController {
  constructor(private readonly config: ConfigService<Env, true>) {}

  @Get('supplierA/hotels')
  supplierA(@Query('city') city?: string): Promise<SupplierHotel[]> {
    return this.forward('supplierA', city);
  }

  @Get('supplierB/hotels')
  supplierB(@Query('city') city?: string): Promise<SupplierHotel[]> {
    return this.forward('supplierB', city);
  }

  private async forward(supplier: SupplierId, city?: string): Promise<SupplierHotel[]> {
    const base = this.config.get(SUPPLIER_URL_ENV[supplier], { infer: true });
    const url = `${base}/hotels${city ? `?city=${encodeURIComponent(city)}` : ''}`;

    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    } catch (cause) {
      throw new ServiceUnavailableException(
        `${supplier} unreachable: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    // A switched-off supplier answers 503; pass its status through unchanged so
    // this path behaves exactly like calling the supplier directly.
    if (!response.ok) throw new ServiceUnavailableException(`${supplier} responded ${response.status}`);
    return (await response.json()) as SupplierHotel[];
  }
}
