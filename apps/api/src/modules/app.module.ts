import { Module } from '@nestjs/common';
import { createChatAgent } from '@packages/agents';
import { getActiveTools } from '@packages/tools';

import { AppController } from './app.controller';

export const CHAT_AGENT_TOKEN = 'CHAT_AGENT';

@Module({
  controllers: [AppController],
  providers: [
    {
      provide: CHAT_AGENT_TOKEN,
      useFactory: () => createChatAgent({ tools: getActiveTools() })
    }
  ]
})
export class AppModule {}
