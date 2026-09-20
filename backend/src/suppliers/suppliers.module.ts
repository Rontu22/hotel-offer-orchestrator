import { Module } from '@nestjs/common';
import { HotelsModule } from '../hotels/hotels.module.js';
import { AvailabilityController } from './availability.controller.js';
import { SupplierAvailabilityService } from './supplier-availability.service.js';

@Module({
  imports: [HotelsModule], // flipping a supplier invalidates the cached aggregates
  controllers: [AvailabilityController],
  providers: [SupplierAvailabilityService],
  exports: [SupplierAvailabilityService],
})
export class SuppliersModule {}
