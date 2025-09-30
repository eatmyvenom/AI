import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { createChatAgent } from '@packages/agents';
import { getActiveTools } from '@packages/tools';

import { AuthGuard } from '../guards/auth.guard';

import { CompletionsController } from './chat/completions/completions.controller';
import { ModelController } from './models/model.controller';

export const CHAT_AGENT_TOKEN = 'CHAT_AGENT';

@Module({
  controllers: [CompletionsController, ModelController],
  providers: [
    {
      provide: CHAT_AGENT_TOKEN,
      useFactory: () => createChatAgent({ tools: getActiveTools() })
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard
    }
  ]
})
export class AppModule {}
