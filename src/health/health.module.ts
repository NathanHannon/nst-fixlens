import {
  Controller,
  Get,
  Module,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
@Controller('health')
export class HealthController {
  constructor(private readonly db: DataSource) {}
  @Get() async check() {
    try {
      await this.db.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('Database unavailable');
    }
  }
}
@Module({ controllers: [HealthController] })
export class HealthModule {}
