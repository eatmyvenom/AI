import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { createLogger } from '@packages/logger';
import { Observable, tap } from 'rxjs';

type RequestLike = {
  method?: string;
  url?: string;
  headers?: Record<string, unknown>;
  ip?: string;
};

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = createLogger('api:request');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestLike>();
    const method = request.method ?? 'UNKNOWN';
    const url = request.url ?? 'UNKNOWN';
    const ip = request.ip ?? 'unknown';

    const startTime = Date.now();

    this.logger.debug(`Incoming request: ${method} ${url}`, {
      method,
      url,
      ip,
      userAgent: request.headers?.['user-agent']
    });

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          this.logger.debug(`Request completed: ${method} ${url}`, {
            method,
            url,
            duration: `${duration}ms`
          });
        },
        error: (error: Error) => {
          const duration = Date.now() - startTime;
          this.logger.debug(`Request failed: ${method} ${url}`, {
            method,
            url,
            duration: `${duration}ms`,
            error: error.message
          });
        }
      })
    );
  }
}
