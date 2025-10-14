import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { createCompletionAgent } from '@packages/agents';
import { getActiveTools } from '@packages/tools';

import { AuthGuard } from '../guards/auth.guard';
import { LoggingInterceptor } from '../interceptors/logging.interceptor';

import { CHAT_AGENT_TOKEN } from './chat/chat.constants';
import { CompletionsController } from './chat/completions/completions.controller';
import { ModelController } from './models/model.controller';
import { HealthController } from './health/health.controller';

@Module({
  controllers: [CompletionsController, ModelController, HealthController],
  providers: [
    {
      provide: CHAT_AGENT_TOKEN,
      useFactory: () =>
        createCompletionAgent({
          defaultAgent: 'plan-act',
          chat: { tools: getActiveTools() },
          planAct: { plan: { tools: getActiveTools() }, act: { tools: getActiveTools() } }
        })
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
