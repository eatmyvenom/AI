import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { createCompletionAgent } from '@packages/agents';
import { loadConfigWithMigration } from '@packages/config';

import { AuthGuard } from '../guards/auth.guard';
import { LoggingInterceptor } from '../interceptors/logging.interceptor';

import { CHAT_AGENT_TOKEN } from './chat/chat.constants';
import { CompletionsController } from './chat/completions/completions.controller';
import { HealthController } from './health/health.controller';
import { ModelController } from './models/model.controller';

@Module({
  controllers: [CompletionsController, ModelController, HealthController],
  providers: [
    {
      provide: CHAT_AGENT_TOKEN,
      useFactory: () => {
        const config = loadConfigWithMigration();
        return createCompletionAgent({
          defaultAgent: 'plan-act',
          // Tools are now handled dynamically per-request in the adapter
          chat: {},
          planAct: {
            model: config.provider.defaultModel
          }
        });
      }
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor
    }
  ]
})
export class AppModule {}

