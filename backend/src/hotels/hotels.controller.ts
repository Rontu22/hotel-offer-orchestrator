import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { FindHotelsDto } from './dto/find-hotels.dto.js';
import type { HotelOffer } from './hotel.types.js';
import { HotelsService } from './hotels.service.js';

@Controller('api/hotels')
export class HotelsController {
  constructor(private readonly hotels: HotelsService) {}

  /**
   * The body stays the plain offer array the spec pins down; the orchestration
   * details clients may care about ride along in headers.
   */
  @Get()
  @Header('Cache-Control', 'no-store')
  async find(@Query() query: FindHotelsDto, @Res({ passthrough: true }) res: Response): Promise<HotelOffer[]> {
    const { offers, cached, degraded } = await this.hotels.find(query);

    res.setHeader('X-Cache', cached ? 'HIT' : 'MISS');
    if (degraded.length > 0) res.setHeader('X-Degraded-Suppliers', degraded.join(', '));

    return offers;
  }
}
