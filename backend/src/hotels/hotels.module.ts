import { Module } from '@nestjs/common';
import { OfferStore } from './offer-store.js';
import { HotelsController } from './hotels.controller.js';
import { HotelsService } from './hotels.service.js';

@Module({
  controllers: [HotelsController],
  providers: [HotelsService, OfferStore],
  exports: [OfferStore],
})
export class HotelsModule {}
