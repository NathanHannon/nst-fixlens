import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../common/demo-user.js';
import type { ActingUser } from '../common/demo-user.js';
import { DiagnoseDto } from './diagnosis.dto.js';
import { DiagnosisService } from './diagnosis.service.js';
@Controller('problems/:id/diagnose')
export class DiagnosisController {
  constructor(private readonly diagnosis: DiagnosisService) {}
  @Post() diagnose(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: ActingUser,
    @Body() dto: DiagnoseDto,
  ) {
    return this.diagnosis.diagnose(id, user.id, dto);
  }
}
