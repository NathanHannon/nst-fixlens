import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Capture, Measurement, Problem, Report } from '../database/entities.js';
import { DIAGNOSIS_PROVIDER } from './diagnosis.provider.js';
import type { DiagnosisProvider } from './diagnosis.provider.js';
import { DiagnoseDto } from './diagnosis.dto.js';
import { SafetyGate } from './safety-gate.service.js';
@Injectable()
export class DiagnosisService {
  constructor(
    private readonly db: DataSource,
    @Inject(DIAGNOSIS_PROVIDER) private readonly provider: DiagnosisProvider,
    private readonly safety: SafetyGate,
  ) {}
  diagnose(id: string, userId: string, dto: DiagnoseDto) {
    return this.db.transaction(async (manager) => {
      const problem = await manager.findOne(Problem, {
        where: { id, user_id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!problem) throw new NotFoundException('Problem not found');
      const capture = await manager.findOneBy(Capture, {
        id: dto.capture_id,
        problem_id: id,
      });
      if (!capture)
        throw new NotFoundException('Capture not found for this problem');
      if (await manager.existsBy(Measurement, { capture_id: capture.id }))
        throw new ConflictException('Capture has already been diagnosed');
      const output = await this.provider.diagnose(problem, capture);
      const result = this.safety.apply(
        output,
        [...(dto.hazards ?? []), ...output.hazards],
        [problem.title, problem.location_note, dto.context].join(' '),
      );
      const measurement = await manager.save(
        Measurement,
        manager.create(Measurement, {
          ...result.measurement,
          capture_id: capture.id,
        }),
      );
      const report = await manager.save(
        Report,
        manager.create(Report, {
          ...result.report,
          problem_id: id,
          capture_id: capture.id,
        }),
      );
      // Cache only the report for the most recent capture (backfilled photos cannot regress urgency).
      const latest = await manager.findOne(Capture, {
        where: { problem_id: id },
        order: { taken_at: 'DESC', id: 'DESC' },
      });
      if (latest?.id === capture.id)
        await manager.update(Problem, id, { current_urgency: report.urgency });
      return { measurement, report };
    });
  }
}
