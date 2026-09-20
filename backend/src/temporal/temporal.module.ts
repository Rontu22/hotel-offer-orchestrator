import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, Connection } from '@temporalio/client';
import type { Env } from '../config/env.js';
import { HotelsModule } from '../hotels/hotels.module.js';
import { HotelActivities } from './activities.js';
import { TEMPORAL_CLIENT } from './temporal.tokens.js';

@Global()
@Module({
  imports: [HotelsModule], // activities write the deduplicated list to the cache
  providers: [
    HotelActivities,
    {
      provide: TEMPORAL_CLIENT,
      inject: [ConfigService],
      useFactory: async (config: ConfigService<Env, true>) => {
        const connection = await Connection.connect({
          address: config.get('TEMPORAL_ADDRESS', { infer: true }),
          // Tolerate the server still coming up behind us on a cold `compose up`.
          connectTimeout: '30s',
        });
        return new Client({ connection, namespace: config.get('TEMPORAL_NAMESPACE', { infer: true }) });
      },
    },
  ],
  exports: [TEMPORAL_CLIENT, HotelActivities],
})
export class TemporalModule implements OnApplicationShutdown {
  constructor(@Inject(TEMPORAL_CLIENT) private readonly client: Client) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.connection.close();
  }
}
