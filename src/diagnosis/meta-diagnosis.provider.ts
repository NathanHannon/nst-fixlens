import {
  BadGatewayException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Urgency } from '../database/entities.js';
import type { Capture, Problem } from '../database/entities.js';
import type {
  DiagnosisProvider,
  DiagnosisResult,
  SegmentationResult,
} from './diagnosis.provider.js';
import type { Hazard, SelectionDto } from './diagnosis.dto.js';
import { MetaModelsService } from '../models/meta-models.service.js';
import { measureSam } from '../models/sam-measurement.js';
import { StorageService } from '../storage/storage.service.js';
import type { Calibration } from '../measurements/calibration.js';
import { brushPreview, cropPhoto } from '../models/analysis-images.js';
import {
  constrainTarget,
  inspectMask,
} from '../models/segmentation-quality.js';

@Injectable()
export class MetaDiagnosisProvider implements DiagnosisProvider {
  private readonly logger = new Logger(MetaDiagnosisProvider.name);
  constructor(
    private readonly models: MetaModelsService,
    private readonly storage: StorageService,
  ) {}
  async segment(
    problem: Problem,
    capture: Capture,
    selection: SelectionDto,
    calibration?: Calibration,
    context?: { text?: string; hazards?: Hazard[] },
  ): Promise<SegmentationResult> {
    const imageUrl = await this.storage.presignRead(capture.photo_key);
    const width = capture.photo_width_px!,
      height = capture.photo_height_px!;
    const source = await this.storage.readPhoto(capture.photo_key).catch(() => {
      throw new BadGatewayException(
        'Could not read the uploaded photo for analysis. Please retry.',
      );
    });
    const annotated = await brushPreview(source, width, height, selection);
    const brushKey = `previews/${problem.id}/${capture.id}-${randomUUID()}.jpg`;
    const deadline = AbortSignal.timeout(180_000);
    const hazards = new Set(context?.hazards ?? []);
    let previous: unknown;
    let targetInfo: SegmentationResult['target'];
    let quality: SegmentationResult['quality'];
    let attempts = 0,
      sam_version = 'not-run',
      reason = 'The intended mark could not be reliably outlined.';
    const unavailable = (): SegmentationResult => ({
      ...(calibration ? { calibration } : {}),
      selection,
      status: 'unavailable',
      reason,
      mask_key: null,
      area_px: null,
      perimeter_px: null,
      sam_version,
      hazards: [...hazards],
      attempts,
      target: targetInfo,
      quality,
    });
    try {
      await this.storage.putAnalysisPhoto(brushKey, annotated).catch(() => {
        throw new BadGatewayException(
          'Could not store the brush preview. Please retry.',
        );
      });
      const brushUrl = await this.storage.presignRead(brushKey);
      for (let round = 0; round < 2; round++) {
        if (deadline.aborted) {
          reason =
            'Highlight preparation timed out. Measurements are unavailable.';
          break;
        }
        const result = await this.models.target(
          imageUrl,
          brushUrl,
          selection,
          width,
          height,
          {
            title: problem.title,
            category_hint: problem.category,
            location: problem.location_note,
            observations: context?.text ?? '',
            reported_hazards: context?.hazards ?? [],
          },
          previous,
          deadline,
        );
        result.plan.hazards.forEach((h) => hazards.add(h));
        targetInfo = {
          description: result.plan.description,
          box: result.plan.box,
          muse_version: result.model,
        };
        if (result.plan.status === 'unclear') {
          reason = result.plan.reason;
          return unavailable();
        }
        const target = constrainTarget(result.plan, selection, width, height);
        if (!target) {
          reason =
            'Muse could not identify a tight region consistent with your brush.';
          previous = {
            description: result.plan.description,
            quality_issues: [reason],
          };
          continue;
        }
        const { crop } = target;
        const key = `previews/${problem.id}/${capture.id}-${randomUUID()}.jpg`;
        try {
          await this.storage.putAnalysisPhoto(
            key,
            await cropPhoto(source, crop),
          );
          const url = await this.storage.presignRead(key);
          const relative = (p: { x: number; y: number }) => ({
            x: p.x - crop.left,
            y: p.y - crop.top,
          });
          attempts++;
          sam_version = this.models.samModel;
          const sam = await this.models.segment(
            url,
            {
              x1: target.box.x1 - crop.left,
              y1: target.box.y1 - crop.top,
              x2: target.box.x2 - crop.left,
              y2: target.box.y2 - crop.top,
              points: target.foreground.map(relative),
            },
            crop.width,
            crop.height,
            target.background.map(relative),
            deadline,
          );
          sam_version = sam.model;
          const measured = measureSam(
            sam.text,
            crop.width,
            crop.height,
            calibration,
            { left: crop.left, top: crop.top, width, height },
          );
          quality = inspectMask(
            measured.mask,
            width,
            height,
            selection,
            target,
          );
          if (!quality.passed) {
            reason = quality.reasons.join(' ');
            previous = {
              description: result.plan.description,
              quality_issues: quality.reasons,
            };
            continue;
          }
          const maskKey = `previews/${problem.id}/${capture.id}-${randomUUID()}.png`;
          try {
            await this.storage.putMask(maskKey, measured.png);
          } catch {
            await this.cleanup(maskKey);
            throw new BadGatewayException(
              'Could not store the highlight. Please retry.',
            );
          }
          return {
            outline_source: 'sam',
            selection,
            status: 'candidate',
            reason: 'Review the highlight before the final assessment.',
            mask_key: maskKey,
            area_px: measured.area_px,
            perimeter_px: measured.perimeter_px,
            sam_version,
            quality,
            target: targetInfo,
            hazards: [...hazards],
            attempts,
            ...(measured.calibration
              ? {
                  calibration: measured.calibration,
                  calibrated_area_mm2: measured.calibrated_area_mm2,
                }
              : {}),
          };
        } catch (error) {
          if (
            error instanceof BadGatewayException &&
            error.message === 'Could not store the highlight. Please retry.'
          )
            throw error;
          if (!(error instanceof HttpException))
            throw new BadGatewayException(
              'Could not prepare the analysis crop. Please retry.',
            );
          const status = error.getStatus();
          if (![422, 502, 503, 504].includes(status)) throw error;
          reason =
            'SAM could not produce a reliable outline. The photo can still be assessed without measurements.';
          previous = {
            description: result.plan.description,
            quality_issues: [reason],
          };
          if (status === 503 || status === 504) break;
        } finally {
          await this.cleanup(key);
        }
      }
      return unavailable();
    } finally {
      await this.cleanup(brushKey);
    }
  }
  async diagnose(
    problem: Problem,
    capture: Capture,
    segmentation: SegmentationResult,
    context?: { text?: string; hazards?: Hazard[] },
  ): Promise<DiagnosisResult> {
    const candidate =
      segmentation.status === 'candidate' &&
      segmentation.quality?.passed &&
      segmentation.mask_key &&
      segmentation.area_px != null &&
      segmentation.perimeter_px != null;
    const [imageUrl, maskUrl] = await Promise.all([
      this.storage.presignRead(capture.photo_key),
      candidate
        ? this.storage.presignRead(segmentation.mask_key!)
        : Promise.resolve(null),
    ]);
    const final = await this.models.refine(
      imageUrl,
      maskUrl,
      {
        title: problem.title,
        category_hint: problem.category,
        location: problem.location_note,
        observations: context?.text ?? '',
        reported_hazards: context?.hazards ?? [],
      },
      {
        selection: segmentation.selection,
        outline_source: segmentation.outline_source ?? 'sam',
        area_px: candidate ? segmentation.area_px : null,
        perimeter_px: candidate ? segmentation.perimeter_px : null,
        target: segmentation.target,
        quality: segmentation.quality ?? {
          passed: false,
          reasons: [segmentation.reason ?? 'No reliable segmentation'],
        },
        ...(candidate && segmentation.calibrated_area_mm2 != null
          ? {
              calibrated_area_mm2: segmentation.calibrated_area_mm2,
              calibration_method: segmentation.calibration?.method,
            }
          : {}),
      },
    );
    // Only confirmed, successfully assessed masks enter permanent storage.
    const accepted = Boolean(
      candidate && final.mask_review.status === 'matches',
    );
    let maskKey: string | null = null;
    if (accepted) {
      maskKey = `masks/${problem.id}/${capture.id}-${randomUUID()}.png`;
      try {
        await this.storage.confirmMask(segmentation.mask_key!, maskKey);
      } catch {
        await this.cleanup(maskKey);
        throw new BadGatewayException(
          'Could not save the confirmed mask. Please retry.',
        );
      }
    }
    const { hazards, confidence, ...report } = final.diagnosis;
    const outline = {
      sam: 'SAM automatic',
      user_corrected: 'manually corrected',
      user_drawn: 'manually traced',
    }[segmentation.outline_source ?? 'sam'];
    return {
      measurement: accepted
        ? {
            mask_key: maskKey,
            area_px: segmentation.area_px!,
            perimeter_px: segmentation.perimeter_px,
            scale_mm_per_px: null,
            calibration: segmentation.calibration ?? null,
            calibrated_area_mm2: segmentation.calibrated_area_mm2 ?? null,
            width_mm: null,
            length_mm: null,
            sam_version: segmentation.sam_version,
          }
        : null,
      report: {
        ...report,
        confidence: confidence.toFixed(2),
        confidence_note: accepted
          ? `Outline source: ${outline}. Mask accepted for approximate measurement: ${final.mask_review.reason} ${report.confidence_note ?? ''}`.slice(
              0,
              2000,
            )
          : `Photo-based assessment; measurements unavailable: ${candidate ? final.mask_review.reason : (segmentation.reason ?? final.mask_review.reason)} Outline source: ${outline}. ${report.confidence_note ?? ''}`.slice(
              0,
              2000,
            ),
        safety_override: false,
        diy: report.urgency === Urgency.ProNow ? null : report.diy,
        spark_version: final.model,
        sam_version: segmentation.sam_version,
      },
      hazards: [...new Set([...hazards, ...(segmentation.hazards ?? [])])],
    };
  }
  private async cleanup(key: string) {
    await this.storage
      .removeMask(key)
      .catch(() => this.logger.warn('Could not clean up an uncommitted mask'));
  }
}
