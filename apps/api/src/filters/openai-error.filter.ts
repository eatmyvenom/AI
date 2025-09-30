import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

type OpenAIErrorType =
  | 'invalid_request_error'
  | 'authentication_error'
  | 'permission_error'
  | 'rate_limit_exceeded'
  | 'server_error';

const STATUS_ERROR_MAP: Record<number, OpenAIErrorType> = {
  [HttpStatus.UNAUTHORIZED]: 'authentication_error',
  [HttpStatus.FORBIDDEN]: 'permission_error',
  [HttpStatus.TOO_MANY_REQUESTS]: 'rate_limit_exceeded'
};

function mapStatusToOpenAIType(status: number): OpenAIErrorType {
  const mapped = STATUS_ERROR_MAP[status];
  if (mapped) {
    return mapped;
  }
  if (status >= 400 && status < 500) {
    return 'invalid_request_error';
  }
  return 'server_error';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractMessageFromResponse(response: unknown): string | undefined {
  if (typeof response === 'string') {
    return response;
  }

  if (!isRecord(response)) {
    return undefined;
  }

  const { message } = response;

  if (typeof message === 'string') {
    return message;
  }

  if (Array.isArray(message)) {
    return message.filter((item): item is string => typeof item === 'string').join('; ');
  }

  return undefined;
}

interface JsonResponseLike {
  status: (statusCode: number) => unknown;
  json: (payload: unknown) => unknown;
}

function isJsonResponseLike(value: unknown): value is JsonResponseLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).status === 'function' &&
    typeof (value as Record<string, unknown>).json === 'function'
  );
}

@Catch()
export class OpenAIErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const responseCandidate = ctx.getResponse<unknown>();

    if (!isJsonResponseLike(responseCandidate)) {
      return;
    }

    const res = responseCandidate;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      const responseMessage = extractMessageFromResponse(response);
      message = responseMessage ?? exception.message;
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    const type = mapStatusToOpenAIType(status);

    res.status(status);
    res.json({
      error: {
        message,
        type,
        param: null,
        code: null
      }
    });
  }
}
