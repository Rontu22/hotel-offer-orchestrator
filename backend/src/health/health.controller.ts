import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService, type HealthReport } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * Liveness only: the process is running. Kept free of dependencies so a supplier
   * outage can never make the container look dead and get restarted or drained.
   */
  @Get('live')
  @HttpCode(200)
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Full dependency report, including both suppliers. 503 only when nothing can be
   * served — a single supplier down is `degraded` and still a 200.
   */
  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const report = await this.health.report();
    res.status(report.status === 'unhealthy' ? 503 : 200);
    return report;
  }
}
