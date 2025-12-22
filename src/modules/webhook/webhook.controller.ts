/**
 * Webhook 接收控制器
 */
import {
  Controller,
  Post,
  Body,
  Headers,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { WebhookHeaders, GitLabWebhookEvent, GitLabPushEvent, GitHubPullRequestEvent, GitHubPushEvent, GitPlatform } from '../../types';

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly webhookService: WebhookService) {}

  /**
   * 接收 GitLab Webhook
   */
  @Post('gitlab')
  @HttpCode(HttpStatus.OK)
  async handleGitLabWebhook(
    @Body() event: GitLabWebhookEvent | GitLabPushEvent,
    @Headers() headers: Record<string, string>,
  ): Promise<{ message: string }> {
    this.logger.log(`Received GitLab webhook: ${event.object_kind}`);

    // 解析请求头配置
    const webhookHeaders = this.parseHeaders(headers);

    // 处理 Merge Request 事件
    if (event.object_kind === 'merge_request') {
      const mrEvent = event as GitLabWebhookEvent;
      // 只处理 opened 或 updated 的 MR
      if (mrEvent.object_attributes.action && !['open', 'update'].includes(mrEvent.object_attributes.action)) {
        return { message: 'Ignored non-open/update action' };
      }

      // 异步处理，避免阻塞响应
      this.webhookService.processWebhook(mrEvent, GitPlatform.GITLAB, webhookHeaders).catch(error => {
        this.logger.error(`Failed to process webhook: ${error.message}`, error.stack);
      });

      return { message: 'Webhook received and processing' };
    }

    // 处理 Push 事件
    if (event.object_kind === 'push') {
      const pushEvent = event as GitLabPushEvent;
      this.logger.log(`Processing push event: after=${pushEvent.after?.substring(0, 8)}, commits=${pushEvent.total_commits_count}`);
      
      // 跳过删除分支和空推送
      if (pushEvent.after === '0000000000000000000000000000000000000000' || pushEvent.total_commits_count === 0) {
        this.logger.warn('Ignored branch deletion or empty push');
        return { message: 'Ignored branch deletion or empty push' };
      }

      // 异步处理，避免阻塞响应
      this.webhookService.processPushWebhook(pushEvent, GitPlatform.GITLAB, webhookHeaders).catch(error => {
        this.logger.error(`Failed to process push webhook: ${error.message}`, error.stack);
        this.logger.error(`Error details: ${JSON.stringify({ 
          message: error.message, 
          stack: error.stack?.split('\n').slice(0, 5).join('\n') 
        })}`);
      });

      return { message: 'Push webhook received and processing' };
    }

    return { message: 'Ignored unsupported event type' };
  }

  /**
   * 接收 GitHub Webhook
   */
  @Post('github')
  @HttpCode(HttpStatus.OK)
  async handleGitHubWebhook(
    @Body() event: GitHubPullRequestEvent | GitHubPushEvent | any,
    @Headers() headers: Record<string, string>,
  ): Promise<{ message: string }> {
    // GitHub webhook 通过 X-GitHub-Event 头区分事件类型
    const eventType = headers['x-github-event'] || headers['X-GitHub-Event'];

    // 处理 Pull Request 事件
    if (eventType === 'pull_request') {
      const prEvent = event as GitHubPullRequestEvent;
      this.logger.log(`Received GitHub webhook: ${prEvent.action}`);

      // 只处理 opened 或 synchronize 的 PR
      if (!['opened', 'synchronize'].includes(prEvent.action)) {
        return { message: 'Ignored non-opened/synchronize action' };
      }

      // 解析请求头配置
      const webhookHeaders = this.parseHeaders(headers);

      // 异步处理，避免阻塞响应
      this.webhookService.processWebhook(prEvent, GitPlatform.GITHUB, webhookHeaders).catch(error => {
        this.logger.error(`Failed to process webhook: ${error.message}`, error.stack);
      });

      return { message: 'Webhook received and processing' };
    }

    // 处理 Push 事件
    if (eventType === 'push') {
      const pushEvent = event as GitHubPushEvent;
      this.logger.log(`Received GitHub push webhook: ${pushEvent.ref}`);

      // 跳过删除分支和空推送
      if (pushEvent.deleted || pushEvent.commits.length === 0) {
        return { message: 'Ignored branch deletion or empty push' };
      }

      // 解析请求头配置
      const webhookHeaders = this.parseHeaders(headers);

      // 异步处理，避免阻塞响应
      this.webhookService.processPushWebhook(pushEvent, GitPlatform.GITHUB, webhookHeaders).catch(error => {
        this.logger.error(`Failed to process push webhook: ${error.message}`, error.stack);
      });

      return { message: 'Push webhook received and processing' };
    }

    return { message: 'Ignored unsupported event type' };
  }

  /**
   * 解析请求头配置
   */
  private parseHeaders(headers: Record<string, string>): WebhookHeaders {
    return {
      // 优先使用请求头中的值，如果没有则使用环境变量默认值
      'x-git-token': headers['x-git-token'] || headers['X-Git-Token'] || process.env.DEFAULT_GIT_TOKEN || '',
      'x-review-mode': (headers['x-review-mode'] || headers['X-Review-Mode']) as any,
      'x-notify-webhook': headers['x-notify-webhook'] || headers['X-Notify-Webhook'] || process.env.DEFAULT_NOTIFY_WEBHOOK,
      'x-git-platform': (headers['x-git-platform'] || headers['X-Git-Platform']) as any,
      'x-git-base-url': headers['x-git-base-url'] || headers['X-Git-Base-Url'] || process.env.DEFAULT_GIT_BASE_URL,
    };
  }
}

