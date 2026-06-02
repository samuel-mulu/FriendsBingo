import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'Internal Server Error';
    let message: string | string[] = 'Internal server error';
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
        error =
          typeof responseBody.error === 'string' ? responseBody.error : error;
        details =
          typeof responseBody.details === 'object' &&
          responseBody.details !== null
            ? (responseBody.details as Record<string, unknown>)
            : undefined;
      }
    }

    response.status(status).json({
      success: false,
      error: {
        statusCode: status,
        error,
        message,
        ...(details ? { details } : {}),
      },
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
