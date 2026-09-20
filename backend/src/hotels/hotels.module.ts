import { Module } from '@nestjs/common';
import { HotelsCache } from './hotels.cache.js';
import { HotelsController } from './hotels.controller.js';
import { HotelsService } from './hotels.service.js';

@Module({
  controllers: [HotelsController],
  providers: [HotelsService, HotelsCache],
  exports: [HotelsCache],
})
export class HotelsModule {}
