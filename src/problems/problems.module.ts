import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Problem, Report, CaptureDelta } from '../database/entities.js';
import { ProblemsController } from './problems.controller.js';
import { ProblemsService } from './problems.service.js';
@Module({
  imports: [TypeOrmModule.forFeature([Problem, Report, CaptureDelta])],
  controllers: [ProblemsController],
  providers: [ProblemsService],
  exports: [ProblemsService],
})
export class ProblemsModule {}
