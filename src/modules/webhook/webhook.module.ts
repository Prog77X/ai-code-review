/**
 * Webhook 模块
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { GitService } from '../../services/git.service';
import { DiffService } from '../../services/diff.service';
import { AstService } from '../../services/ast.service';
import { TokenService } from '../../services/token.service';
import { PromptService } from '../../services/prompt.service';
import { AiAgentService } from '../../services/ai-agent.service';
import { PublishService } from '../../services/publish.service';

@Module({
  imports: [ConfigModule],
  controllers: [WebhookController],
  providers: [
    WebhookService,
    GitService,
    DiffService,
    AstService,
    TokenService,
    PromptService,
    AiAgentService,
    PublishService,
  ],
})
export class WebhookModule {}

