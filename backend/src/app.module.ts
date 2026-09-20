import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { HotelsModule } from './hotels/hotels.module.js';
import { RedisModule } from './redis/redis.module.js';
import { SuppliersModule } from './suppliers/suppliers.module.js';
import { TemporalModule } from './temporal/temporal.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    RedisModule,
    HealthModule,
    HotelsModule,
    TemporalModule,
    SuppliersModule,
  ],
})
export class AppModule {}
