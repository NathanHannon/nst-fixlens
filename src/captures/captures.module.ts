import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Capture } from '../database/entities.js';
import { ProblemsModule } from '../problems/problems.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { CapturesService } from './captures.service.js';
import { CapturesController } from './captures.controller.js';
@Module({
  imports: [TypeOrmModule.forFeature([Capture]), ProblemsModule, StorageModule],
  controllers: [CapturesController],
  providers: [CapturesService],
})
export class CapturesModule {}
