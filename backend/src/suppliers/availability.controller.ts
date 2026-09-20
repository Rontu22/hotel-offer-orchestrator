import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Put,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { HotelsCache } from '../hotels/hotels.cache.js';
import { SetAvailabilityDto } from './dto/set-availability.dto.js';
import { SupplierAvailabilityService } from './supplier-availability.service.js';
import { isSupplierId, type SupplierId } from './supplier.types.js';

/**
 * Control plane for the fault-injection switch. Unauthenticated, so it is gated
 * behind a flag rather than shipped open: it can degrade the service on purpose.
 */
@Controller('api/suppliers')
export class AvailabilityController {
  constructor(
    private readonly availability: SupplierAvailabilityService,
    private readonly cache: HotelsCache,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get()
  list(): Promise<Record<SupplierId, boolean>> {
    return this.availability.list();
  }

  @Put(':supplier/availability')
  async set(
    @Param('supplier') supplier: string,
    @Body() body: SetAvailabilityDto,
  ): Promise<Record<SupplierId, boolean>> {
    if (!this.config.get('ENABLE_FAULT_INJECTION', { infer: true })) {
      throw new ForbiddenException('Fault injection is disabled');
    }
    if (!isSupplierId(supplier)) {
      throw new BadRequestException(`Unknown supplier "${supplier}"`);
    }

    await this.availability.set(supplier, body.available);
    // Supplier availability changed, so every cached aggregate is now stale.
    await this.cache.invalidateAll();

    return this.availability.list();
  }
}
