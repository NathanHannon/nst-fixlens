import { Module } from '@nestjs/common';
import { MeasurementsModule } from '../measurements/measurements.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { DiagnosisController } from './diagnosis.controller.js';
import { DiagnosisService } from './diagnosis.service.js';
import { SafetyGate } from './safety-gate.service.js';
import {
  DIAGNOSIS_PROVIDER,
  MockDiagnosisProvider,
} from './diagnosis.provider.js';
@Module({
  imports: [MeasurementsModule, ReportsModule],
  controllers: [DiagnosisController],
  providers: [
    DiagnosisService,
    SafetyGate,
    { provide: DIAGNOSIS_PROVIDER, useClass: MockDiagnosisProvider },
  ],
})
export class DiagnosisModule {}
