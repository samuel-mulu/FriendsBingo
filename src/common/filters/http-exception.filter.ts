import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'Internal Server Error';
    let message: string | string[] = 'Internal server error';
    let code: string | undefined;
    let details: Record<string, unknown> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();

      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        error = exception.name;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const responseBody = exceptionResponse as Record<string, unknown>;
        message =
          typeof responseBody.message === 'string' ||
          Array.isArray(responseBody.message)
            ? (responseBody.message as string | string[])
            : message;
        code = typeof responseBody.code === 'string' ? responseBody.code : code;
        error =
          typeof responseBody.error === 'string' ? responseBody.error : error;
        details =
          typeof responseBody.details === 'object' &&
          responseBody.details !== null
            ? (responseBody.details as Record<string, unknown>)
            : undefined;
      }
    } else if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      exception.code === 'P2022'
    ) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      error = 'DatabaseSchemaError';
      message =
        'Database schema is out of date. Run pending Prisma migrations on this environment.';
      details = { prismaCode: exception.code, column: exception.meta?.column };
      this.logger.error(
        `${request.method} ${request.url} schema mismatch: ${exception.message}`,
        exception.stack,
      );
    } else {
      this.logger.error(
        `${request.method} ${request.url} unhandled exception`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      success: false,
      error: {
        statusCode: status,
        error,
        message,
        ...(code ? { code } : {}),
        ...(details ? { details } : {}),
      },
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
