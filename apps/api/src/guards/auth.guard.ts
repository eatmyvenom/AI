import type { IncomingHttpHeaders } from 'node:http';

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

type RequestWithHeaders = {
  headers: IncomingHttpHeaders;
};

function isRequestWithHeaders(value: unknown): value is RequestWithHeaders {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const headers = candidate.headers;
  return typeof headers === 'object' && headers !== null;
}

function getHeader(headers: IncomingHttpHeaders, name: string): string | undefined {
  const headerValue = headers[name];

  if (Array.isArray(headerValue)) {
    const [first] = headerValue;
    return typeof first === 'string' ? first : undefined;
  }

  return typeof headerValue === 'string' ? headerValue : undefined;
}

function extractBearerToken(headerValue: string | undefined): string | undefined {
  if (typeof headerValue !== 'string') {
    return undefined;
  }

  const trimmed = headerValue.trim();
  if (!trimmed.startsWith('Bearer ')) {
    return undefined;
  }

  const token = trimmed.slice('Bearer '.length).trim();
  return token.length > 0 ? token : undefined;
}

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const requestCandidate = context.switchToHttp().getRequest<unknown>();

    if (!isRequestWithHeaders(requestCandidate)) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const headers = requestCandidate.headers;
    const headerValue = getHeader(headers, 'authorization') ?? getHeader(headers, 'Authorization');
    const token = extractBearerToken(headerValue);

    if (token) {
      return true;
    }

    throw new UnauthorizedException('Missing or invalid Authorization header');
  }
}
