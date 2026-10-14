import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
@Catch()
export class JsonErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(JsonErrorFilter.name);
  catch(error: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    let status = 500;
    let message: string | string[] = 'Internal server error';
    if (error instanceof HttpException) {
      status = error.getStatus();
      const payload = error.getResponse();
      message =
        typeof payload === 'string'
          ? payload
          : (payload as { message: string | string[] }).message;
    } else if (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string }).code === '23505'
    ) {
      status = 409;
      message = 'Resource already exists (capture or baseline conflict)';
    } else {
      this.logger.error(error instanceof Error ? error.stack : String(error));
    }
    ctx
      .getResponse<Response>()
      .status(status)
      .json({
        error: { status, message, path: ctx.getRequest<Request>().path },
      });
  }
}
