import { Controller, Get } from '@nestjs/common';

@Controller('v1/health')
export class HealthController {
  @Get()
  health() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: Math.floor(Date.now() / 1000)
    };
  }
}

