/**
 * 核心类型定义
 */

// 重新导出 GitLab 和 GitHub 类型
export type { GitLabWebhookEvent, GitLabMergeRequestDiff, GitLabChange, GitLabPushEvent, GitLabDiffRefs, GitLabMergeRequestChanges } from './gitlab';
export type { GitHubPullRequestEvent, GitHubPullRequestFile, GitHubPushEvent } from './github';

/**
 * Git 平台类型
 */
export enum GitPlatform {
  GITLAB = 'gitlab',
  GITHUB = 'github',
}

/**
 * 评审模式
 */
export enum ReviewMode {
  COMMENT = 'comment', // 行级评论模式
  REPORT = 'report', // 报告模式
}

/**
 * Webhook 请求头配置
 */
export interface WebhookHeaders {
  'x-git-token': string; // Git 平台认证 Token（必需）
  'x-review-mode'?: ReviewMode; // 评审模式：report 或 comment
  'x-notify-webhook'?: string; // 企业通知 Webhook URL
  'x-git-platform'?: GitPlatform; // Git 平台类型
  'x-git-base-url'?: string; // Git 平台 API 基础 URL
}

/**
 * Merge Request 基本信息
 */
export interface MergeRequestInfo {
  username: string; // 用户名
  projectName: string; // 项目名
  sourceBranch: string; // 源分支
  targetBranch: string; // 目标分支
  mrId: string; // MR ID
  projectId: string; // 项目 ID
  mrUrl: string; // MR URL
  commitMessage?: string; // Commit message
}

/**
 * 文件变更信息
 */
export interface FileChange {
  oldPath: string; // 旧文件路径
  newPath: string; // 新文件路径
  diff: string; // Diff 内容
  additions: number; // 新增行数
  deletions: number; // 删除行数
}

/**
 * 带行号的 Diff 行
 */
export interface DiffLine {
  lineNumber: number; // 真实行号
  content: string; // 行内容
  type: 'added' | 'removed' | 'context'; // 行类型
  oldLineNumber?: number; // 旧文件行号（删除行）
  newLineNumber?: number; // 新文件行号（新增行）
}

/**
 * 扩展的 Diff 内容
 */
export interface ExtendedDiff {
  filePath: string; // 文件路径
  oldPath?: string; // 旧文件路径
  diffLines: DiffLine[]; // 带行号的 diff 行
  commitMessage?: string; // Commit message
}

/**
 * AST 代码块
 */
export interface CodeBlock {
  code: string; // 代码内容
  startLine: number; // 起始行号
  endLine: number; // 结束行号
  type: 'function' | 'class' | 'method' | 'unknown'; // 代码块类型
  name?: string; // 函数/类名
}

/**
 * 评审问题
 */
export interface ReviewIssue {
  type: 'critical' | 'warning' | 'info'; // 问题严重性
  file: string; // 文件路径
  line: number; // 行号
  title: string; // 问题标题
  description: string; // 问题描述
  code?: string; // 相关代码片段
  suggestion?: string; // 改进建议
}

/**
 * AI 评审结果（YAML 格式）
 */
export interface ReviewResult {
  issues: ReviewIssue[]; // 问题列表
  summary?: string; // 总结
}

/**
 * Git API 响应类型
 */
export interface GitApiResponse<T = any> {
  data: T;
  status: number;
}

/**
 * 配置接口
 */
export interface AppConfig {
  port: number;
  nodeEnv: string;
  ai: {
    apiBaseUrl: string;
    model: string;
    apiKey: string;
    maxTokens: number;
    temperature: number;
  };
  git: {
    defaultPlatform: GitPlatform;
    defaultBaseUrl: string;
  };
  token: {
    maxInputTokens: number;
    reservedOutputTokens: number;
  };
  ast: {
    maxChars: number;
    maxLines: number;
    timeoutMs: number;
    maxDepth: number;
  };
  rateLimit: {
    webhookMs: number;
  };
  supportedExtensions: string[];
  gitSkipSslVerify?: boolean;
}

