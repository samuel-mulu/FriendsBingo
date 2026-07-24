import { Controller, ForbiddenException, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { isInternalOrLocalIp } from './internal-network.util';
import { ObservabilityService } from './observability.service';

@Controller()
export class MetricsController {
  constructor(private readonly observability: ObservabilityService) {}

  @Get('metrics')
  async getMetrics(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    if (!isInternalOrLocalIp(request.ip)) {
      throw new ForbiddenException('Metrics are only available internally');
    }

    response.setHeader('Content-Type', this.observability.contentType);
    response.send(await this.observability.getMetrics());
  }
}
