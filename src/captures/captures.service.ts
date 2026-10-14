import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Capture } from '../database/entities.js';
import { ProblemsService } from '../problems/problems.service.js';
import { StorageService } from '../storage/storage.service.js';
import { RegisterCaptureDto } from './capture.dto.js';
@Injectable()
export class CapturesService {
  constructor(
    @InjectRepository(Capture) private readonly captures: Repository<Capture>,
    private readonly problems: ProblemsService,
    private readonly storage: StorageService,
  ) {}
  async upload(id: string, userId: string) {
    await this.problems.owned(id, userId);
    const capture_id = randomUUID();
    const photo_key = `captures/${id}/${capture_id}.jpg`;
    return {
      capture_id,
      photo_key,
      ...(await this.storage.presign(photo_key)),
    };
  }
  async register(id: string, userId: string, dto: RegisterCaptureDto) {
    await this.problems.owned(id, userId);
    const captureId = dto.photo_key.split('/')[2]?.replace(/\.jpg$/, '');
    if (
      !captureId ||
      !isUUID(captureId) ||
      dto.photo_key !== `captures/${id}/${captureId}.jpg`
    )
      throw new BadRequestException(
        'photo_key must match this problem and contain a valid capture UUID',
      );
    if (
      dto.is_baseline &&
      (dto.alignment_score != null || dto.alignment_meta != null)
    )
      throw new BadRequestException(
        'Baseline captures cannot have alignment data',
      );
    if (!(await this.storage.exists(dto.photo_key)))
      throw new BadRequestException(
        'Upload a non-empty JPEG before registering the capture',
      );
    return this.captures.save(
      this.captures.create({
        ...dto,
        id: captureId,
        problem_id: id,
        taken_at: dto.taken_at ? new Date(dto.taken_at) : new Date(),
        alignment_score: dto.alignment_score?.toFixed(3),
      }),
    );
  }
}
