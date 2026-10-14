import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/demo-user.js';
import type { ActingUser } from '../common/demo-user.js';
import { CreateProblemDto } from './problem.dto.js';
import { ProblemsService } from './problems.service.js';
@Controller('problems')
export class ProblemsController {
  constructor(private readonly problems: ProblemsService) {}
  @Post() create(
    @CurrentUser() user: ActingUser,
    @Body() dto: CreateProblemDto,
  ) {
    return this.problems.create(user.id, dto);
  }
  @Get() list(@CurrentUser() user: ActingUser) {
    return this.problems.list(user.id);
  }
  @Get(':id') detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: ActingUser,
  ) {
    return this.problems.detail(id, user.id);
  }
  @Get(':id/deltas') deltas(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: ActingUser,
  ) {
    return this.problems.deltas(id, user.id);
  }
}
