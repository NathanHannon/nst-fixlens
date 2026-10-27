import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Problem,
  CaptureDelta,
  Report,
  Measurement,
} from '../database/entities.js';
import { CreateProblemDto } from './problem.dto.js';
@Injectable()
export class ProblemsService {
  constructor(
    @InjectRepository(Problem) private readonly problems: Repository<Problem>,
    @InjectRepository(Report) private readonly reports: Repository<Report>,
    @InjectRepository(CaptureDelta)
    private readonly deltaRows: Repository<CaptureDelta>,
  ) {}
  create(userId: string, dto: CreateProblemDto) {
    return this.problems.save(
      this.problems.create({ ...dto, user_id: userId }),
    );
  }
  list(userId: string) {
    return this.problems.find({
      where: { user_id: userId },
      order: { created_at: 'DESC', id: 'DESC' },
    });
  }
  async owned(id: string, userId: string) {
    const problem = await this.problems.findOneBy({ id, user_id: userId });
    if (!problem) throw new NotFoundException('Problem not found');
    return problem;
  }
  async deltas(id: string, userId: string) {
    await this.owned(id, userId);
    return this.deltaRows
      .createQueryBuilder('d')
      .innerJoin('captures', 'c', 'c.id = d.to_capture_id')
      .where('d.problem_id = :id', { id })
      .orderBy('c.taken_at', 'DESC')
      .addOrderBy('c.id', 'DESC')
      .getMany();
  }
  async detail(id: string, userId: string) {
    const problem = await this.owned(id, userId);
    const [latest_report, deltas] = await Promise.all([
      this.reports.findOne({
        where: { problem_id: id },
        order: { created_at: 'DESC', id: 'DESC' },
      }),
      this.deltas(id, userId),
    ]);
    const latest_measurement = latest_report
      ? await this.reports.manager.findOneBy(Measurement, {
          capture_id: latest_report.capture_id,
        })
      : null;
    return {
      ...problem,
      latest_report,
      latest_measurement,
      delta_summary:
        deltas.find((d) => d.to_capture_id === latest_report?.capture_id) ??
        null,
    };
  }
}
