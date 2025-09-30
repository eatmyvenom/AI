import { Controller, Get, NotFoundException, Param } from '@nestjs/common';

type OpenAIModel = {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
};

@Controller('v1/models')
export class ModelController {
  @Get()
  listModels(): { object: 'list'; data: OpenAIModel[] } {
    const id = process.env.MODEL ?? 'gpt-5';
    const created = Math.floor(Date.now() / 1000);

    return {
      object: 'list',
      data: [
        {
          id,
          object: 'model',
          created,
          owned_by: 'system'
        }
      ]
    };
  }

  @Get(':id')
  getModel(@Param('id') id: string): OpenAIModel {
    const defaultId = process.env.MODEL ?? 'gpt-4.1-mini';

    if (id !== defaultId) {
      throw new NotFoundException(`Model ${id} does not exist`);
    }

    return {
      id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'system'
    };
  }
}
