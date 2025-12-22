/**
 * Webhook 处理服务
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GitPlatform,
  ReviewMode,
  WebhookHeaders,
  MergeRequestInfo,
  FileChange,
  ExtendedDiff,
  ReviewIssue,
  AppConfig,
  GitLabWebhookEvent,
  GitLabPushEvent,
  GitHubPullRequestEvent,
  GitHubPushEvent,
} from '../../types';
import { GitService } from '../../services/git.service';
import { DiffService } from '../../services/diff.service';
import { AstService } from '../../services/ast.service';
import { TokenService } from '../../services/token.service';
import { PromptService } from '../../services/prompt.service';
import { AiAgentService } from '../../services/ai-agent.service';
import { PublishService } from '../../services/publish.service';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly processedMRs: Map<string, number> = new Map(); // MR ID -> timestamp

  constructor(
    private readonly configService: ConfigService<AppConfig>,
    private readonly gitService: GitService,
    private readonly diffService: DiffService,
    private readonly astService: AstService,
    private readonly tokenService: TokenService,
    private readonly promptService: PromptService,
    private readonly aiAgentService: AiAgentService,
    private readonly publishService: PublishService,
  ) {}

  /**
   * 处理 Webhook 事件
   */
  async processWebhook(
    event: GitLabWebhookEvent | GitHubPullRequestEvent,
    platform: GitPlatform,
    headers: WebhookHeaders,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // 1. 验证配置
      this.validateHeaders(headers);

      // 2. 解析 MR 信息
      const mrInfo = this.gitService.parseMergeRequestInfo(event, platform);
      this.logger.log(`Processing MR: ${mrInfo.mrId} in ${mrInfo.projectName}`);

      // 3. 防重复处理
      if (this.isDuplicate(mrInfo)) {
        this.logger.warn(`Skipping duplicate MR: ${mrInfo.mrId}`);
        return;
      }

      // 4. 获取配置（使用环境变量和默认值）
      const gitBaseUrl = headers['x-git-base-url'] || process.env.DEFAULT_GIT_BASE_URL || 'https://gitlab.com/api/v4';
      const gitToken = headers['x-git-token'] || process.env.DEFAULT_GIT_TOKEN || '';
      const reviewMode = (headers['x-review-mode'] || ReviewMode.REPORT) as ReviewMode;
      const notifyWebhook = headers['x-notify-webhook'] || process.env.DEFAULT_NOTIFY_WEBHOOK;
      const supportedExtensions = (process.env.SUPPORTED_EXTENSIONS || 'ts,tsx,js,jsx,vue,py').split(',');
      
      // 构建配置对象
      const config: AppConfig = {
        port: parseInt(process.env.PORT || '3000', 10),
        nodeEnv: process.env.NODE_ENV || 'development',
        ai: {
          apiBaseUrl: process.env.AI_API_BASE_URL || 'https://api.openai.com/v1',
          model: process.env.AI_MODEL || 'gpt-4-turbo-preview',
          apiKey: process.env.AI_API_KEY || '',
          maxTokens: parseInt(process.env.AI_MAX_TOKENS || '4096', 10),
          temperature: parseFloat(process.env.AI_TEMPERATURE || '0.3'),
        },
        git: {
          defaultPlatform: (process.env.DEFAULT_GIT_PLATFORM as GitPlatform) || GitPlatform.GITLAB,
          defaultBaseUrl: gitBaseUrl,
        },
        token: {
          maxInputTokens: parseInt(process.env.MAX_INPUT_TOKENS || '8000', 10),
          reservedOutputTokens: parseInt(process.env.RESERVED_OUTPUT_TOKENS || '2000', 10),
        },
        ast: {
          maxChars: parseInt(process.env.AST_MAX_CHARS || '10000', 10),
          maxLines: parseInt(process.env.AST_MAX_LINES || '150', 10),
          timeoutMs: parseInt(process.env.AST_TIMEOUT_MS || '8000', 10),
          maxDepth: parseInt(process.env.AST_MAX_DEPTH || '60', 10),
        },
        rateLimit: {
          webhookMs: parseInt(process.env.WEBHOOK_RATE_LIMIT_MS || '60000', 10),
        },
        supportedExtensions,
      };

      // 5. 获取变更文件
      const fileChanges = await this.gitService.getMergeRequestChanges(
        mrInfo,
        platform,
        gitBaseUrl,
        gitToken,
        config.supportedExtensions,
      );

      if (fileChanges.length === 0) {
        this.logger.log('No code files changed, skipping review');
        return;
      }

      this.logger.log(`Found ${fileChanges.length} changed files`);

      // 6. 处理每个文件的 diff
      const allIssues: ReviewIssue[] = [];
      const totalFiles = fileChanges.length;
      let processedFiles = 0;

      this.logger.log(`Starting review of ${totalFiles} files...`);

      for (const fileChange of fileChanges) {
        try {
          processedFiles++;
          if (processedFiles % 10 === 0 || processedFiles === totalFiles) {
            this.logger.log(`Progress: ${processedFiles}/${totalFiles} files processed`);
          }

          const issues = await this.reviewFile(
            fileChange,
            mrInfo,
            config,
            platform,
            gitBaseUrl,
            gitToken,
          );
          allIssues.push(...issues);
        } catch (error: any) {
          this.logger.warn(`Failed to review file ${fileChange.newPath}: ${error.message}`);
          // 继续处理其他文件，不中断整个流程
        }
      }

      this.logger.log(`Completed review of ${totalFiles} files, found ${allIssues.length} issues`);

      // 7. 发布评审结果
      if (allIssues.length > 0 || reviewMode === ReviewMode.REPORT) {
        await this.publishService.publishReview(
          mrInfo,
          allIssues,
          reviewMode,
          platform,
          gitBaseUrl,
          gitToken,
          notifyWebhook,
        );
      }

      const duration = Date.now() - startTime;
      this.logger.log(`Review completed in ${duration}ms, found ${allIssues.length} issues`);

      // 8. 记录处理时间
      this.recordProcessed(mrInfo);
    } catch (error: any) {
      this.logger.error(`Webhook processing failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * 评审单个文件
   */
  private async reviewFile(
    fileChange: FileChange,
    mrInfo: MergeRequestInfo,
    config: AppConfig,
    platform: GitPlatform,
    gitBaseUrl: string,
    gitToken: string,
  ): Promise<ReviewIssue[]> {
    try {
      // 1. 解析 diff
      this.logger.debug(`Parsing diff for ${fileChange.newPath}`);
      const extendedDiff = this.diffService.parseDiff(
        fileChange.diff,
        fileChange.newPath,
        fileChange.oldPath,
      );

      // 2. AST 分析（提取代码块）
      this.logger.debug(`Extracting code blocks for ${fileChange.newPath}`);
      const codeBlocks = this.astService.extractCodeBlocks(
        extendedDiff.diffLines,
        fileChange.newPath,
        config,
      );

      // 3. 构建提示词
      this.logger.debug(`Building prompt for ${fileChange.newPath}`);
      const diffContent = this.diffService.buildNumberedDiff(extendedDiff);
      const prompt = this.promptService.buildPrompt(diffContent);

      // 4. 检查 token 限制
      const inputTokens = this.tokenService.countTokens(prompt, config.ai.model);
      const availableTokens = this.tokenService.calculateAvailableTokens(config, inputTokens);

      this.logger.debug(`Token check for ${fileChange.newPath}: input=${inputTokens}, available=${availableTokens}`);

      if (availableTokens < 0) {
        this.logger.warn(`Token limit exceeded for ${fileChange.newPath}, skipping AI review`);
        return [];
      }

      // 5. 调用 AI 评审
      this.logger.log(`Calling AI review for ${fileChange.newPath}...`);
      const reviewResult = await this.aiAgentService.reviewCode(prompt, config);
      this.logger.log(`AI review completed for ${fileChange.newPath}, found ${reviewResult.issues?.length || 0} issues`);

      // 6. 处理评审结果
      const issues = this.processReviewResult(reviewResult, fileChange.newPath);
      this.logger.debug(`Processed ${issues.length} issues for ${fileChange.newPath}`);

      return issues;
    } catch (error: any) {
      this.logger.error(`Error reviewing file ${fileChange.newPath}: ${error.message}`, error.stack);
      throw error; // 重新抛出，让上层处理
    }
  }

  /**
   * 处理评审结果
   */
  private processReviewResult(
    reviewResult: { issues: ReviewIssue[]; summary?: string },
    filePath: string,
  ): ReviewIssue[] {
    // 确保所有问题都有文件路径
    return reviewResult.issues.map(issue => ({
      ...issue,
      file: issue.file || filePath,
    }));
  }

  /**
   * 验证请求头配置
   */
  private validateHeaders(headers: WebhookHeaders): void {
    if (!headers['x-git-token']) {
      throw new Error('Missing required header: x-git-token');
    }
  }

  /**
   * 检查是否为重复处理
   */
  private isDuplicate(mrInfo: MergeRequestInfo): boolean {
    const key = `${mrInfo.projectId}-${mrInfo.mrId}`;
    const lastProcessed = this.processedMRs.get(key);
    // 直接从环境变量获取，提供默认值
    const rateLimitMs = parseInt(process.env.WEBHOOK_RATE_LIMIT_MS || '60000', 10);

    if (lastProcessed && Date.now() - lastProcessed < rateLimitMs) {
      return true;
    }

    return false;
  }

  /**
   * 处理 Push Webhook 事件
   */
  async processPushWebhook(
    event: GitLabPushEvent | GitHubPushEvent,
    platform: GitPlatform,
    headers: WebhookHeaders,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.log(`Starting push webhook processing for platform: ${platform}`);
      
      // 1. 验证配置
      this.validateHeaders(headers);
      this.logger.log('Headers validated successfully');

      // 2. 解析 Push 信息
      const pushInfo = this.gitService.parsePushInfo(event, platform);
      const beforeSha = platform === GitPlatform.GITLAB 
        ? (event as GitLabPushEvent).before 
        : (event as GitHubPushEvent).before;
      const afterSha = platform === GitPlatform.GITLAB 
        ? (event as GitLabPushEvent).after 
        : (event as GitHubPushEvent).after;

      this.logger.log(`Processing push: ${afterSha.substring(0, 8)} in ${pushInfo.projectName}`);

      // 3. 防重复处理
      const pushKey = `${pushInfo.projectId}-${afterSha}`;
      const rateLimitMs = parseInt(process.env.WEBHOOK_RATE_LIMIT_MS || '60000', 10);
      const lastProcessed = this.processedMRs.get(pushKey);
      if (lastProcessed && Date.now() - lastProcessed < rateLimitMs) {
        this.logger.warn(`Skipping duplicate push: ${afterSha.substring(0, 8)}`);
        return;
      }

      // 4. 获取配置
      const gitBaseUrl = headers['x-git-base-url'] || process.env.DEFAULT_GIT_BASE_URL || 'https://gitlab.com/api/v4';
      const gitToken = headers['x-git-token'] || process.env.DEFAULT_GIT_TOKEN || '';
      const reviewMode = (headers['x-review-mode'] || ReviewMode.REPORT) as ReviewMode;
      const notifyWebhook = headers['x-notify-webhook'] || process.env.DEFAULT_NOTIFY_WEBHOOK;
      const supportedExtensions = (process.env.SUPPORTED_EXTENSIONS || 'ts,tsx,js,jsx,vue,py').split(',');
      
      this.logger.log(`Configuration: gitBaseUrl=${gitBaseUrl}, gitToken=${gitToken ? '***' + gitToken.slice(-4) : 'NOT SET'}, reviewMode=${reviewMode}`);
      
      if (!gitToken) {
        throw new Error('Git token is required. Please set x-git-token header or DEFAULT_GIT_TOKEN environment variable.');
      }

      const config: AppConfig = {
        port: parseInt(process.env.PORT || '3000', 10),
        nodeEnv: process.env.NODE_ENV || 'development',
        ai: {
          apiBaseUrl: process.env.AI_API_BASE_URL || 'https://api.openai.com/v1',
          model: process.env.AI_MODEL || 'gpt-4-turbo-preview',
          apiKey: process.env.AI_API_KEY || '',
          maxTokens: parseInt(process.env.AI_MAX_TOKENS || '4096', 10),
          temperature: parseFloat(process.env.AI_TEMPERATURE || '0.3'),
        },
        git: {
          defaultPlatform: (process.env.DEFAULT_GIT_PLATFORM as GitPlatform) || GitPlatform.GITLAB,
          defaultBaseUrl: gitBaseUrl,
        },
        token: {
          maxInputTokens: parseInt(process.env.MAX_INPUT_TOKENS || '8000', 10),
          reservedOutputTokens: parseInt(process.env.RESERVED_OUTPUT_TOKENS || '2000', 10),
        },
        ast: {
          maxChars: parseInt(process.env.AST_MAX_CHARS || '10000', 10),
          maxLines: parseInt(process.env.AST_MAX_LINES || '150', 10),
          timeoutMs: parseInt(process.env.AST_TIMEOUT_MS || '8000', 10),
          maxDepth: parseInt(process.env.AST_MAX_DEPTH || '60', 10),
        },
        rateLimit: {
          webhookMs: parseInt(process.env.WEBHOOK_RATE_LIMIT_MS || '60000', 10),
        },
        supportedExtensions,
      };

      // 5. 获取变更文件
      this.logger.log(`Fetching push changes: before=${beforeSha.substring(0, 8)}, after=${afterSha.substring(0, 8)}`);
      const fileChanges = await this.gitService.getPushChanges(
        pushInfo,
        platform,
        gitBaseUrl,
        gitToken,
        config.supportedExtensions,
        beforeSha,
        afterSha,
      );

      this.logger.log(`Found ${fileChanges.length} changed files`);
      if (fileChanges.length === 0) {
        this.logger.log('No code files changed, skipping review');
        return;
      }

      // 6. 处理每个文件的 diff
      const allIssues: ReviewIssue[] = [];
      const totalFiles = fileChanges.length;
      let processedFiles = 0;

      this.logger.log(`Starting review of ${totalFiles} files...`);

      for (const fileChange of fileChanges) {
        try {
          processedFiles++;
          if (processedFiles % 10 === 0 || processedFiles === totalFiles) {
            this.logger.log(`Progress: ${processedFiles}/${totalFiles} files processed`);
          }

          const issues = await this.reviewFile(
            fileChange,
            pushInfo,
            config,
            platform,
            gitBaseUrl,
            gitToken,
          );
          allIssues.push(...issues);
        } catch (error: any) {
          this.logger.warn(`Failed to review file ${fileChange.newPath}: ${error.message}`);
        }
      }

      this.logger.log(`Completed review of ${totalFiles} files, found ${allIssues.length} issues`);

      // 7. 发布评审结果
      if (allIssues.length > 0 || reviewMode === ReviewMode.REPORT) {
        await this.publishService.publishPushReview(
          pushInfo,
          allIssues,
          reviewMode,
          platform,
          gitBaseUrl,
          gitToken,
          afterSha,
          notifyWebhook,
        );
      }

      const duration = Date.now() - startTime;
      this.logger.log(`Push review completed in ${duration}ms, found ${allIssues.length} issues`);

      // 8. 记录处理时间
      this.processedMRs.set(pushKey, Date.now());
    } catch (error: any) {
      this.logger.error(`Push webhook processing failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * 记录已处理的 MR
   */
  private recordProcessed(mrInfo: MergeRequestInfo): void {
    const key = `${mrInfo.projectId}-${mrInfo.mrId}`;
    this.processedMRs.set(key, Date.now());

    // 清理旧的记录（保留最近1小时的记录）
    const oneHourAgo = Date.now() - 3600000;
    for (const [k, timestamp] of this.processedMRs.entries()) {
      if (timestamp < oneHourAgo) {
        this.processedMRs.delete(k);
      }
    }
  }
}

