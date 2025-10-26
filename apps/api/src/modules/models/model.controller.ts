import { Controller, Get, NotFoundException, Options, Param, Res } from '@nestjs/common';
import { loadConfigWithMigration } from '@packages/config';
import type { Response } from 'express';

type OpenAIModel = {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
};

@Controller('v1/models')
export class ModelController {
  @Options()
  handleOptions(@Res() res: Response): void {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.status(204).send();
  }

  @Get()
  listModels(): { object: 'list'; data: OpenAIModel[] } {
    const created = Math.floor(Date.now() / 1000);
    const config = loadConfigWithMigration();

    const planActModel: OpenAIModel = {
      id: 'plan-act',
      object: 'model',
      created,
      owned_by: 'plan-act-agent'
    };

    const defaultChatModelId = config.provider.defaultModel;

    return {
      object: 'list',
      data: [
        planActModel,
        {
          id: defaultChatModelId,
          object: 'model',
          created,
          owned_by: 'chat-agent'
        }
      ]
    };
  }

  @Get(':id')
  getModel(@Param('id') id: string): OpenAIModel {
    const created = Math.floor(Date.now() / 1000);
    const config = loadConfigWithMigration();

    if (id === 'plan-act') {
      return {
        id,
        object: 'model',
        created,
        owned_by: 'plan-act-agent'
      };
    }

    const defaultId = config.provider.defaultModel;

    if (id === defaultId) {
      return {
        id,
        object: 'model',
        created,
        owned_by: 'chat-agent'
      };
    }

    throw new NotFoundException(`Model ${id} does not exist`);
  }
}
