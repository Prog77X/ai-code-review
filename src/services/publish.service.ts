/**
 * 发布服务模块
 */
import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import {
  GitPlatform,
  MergeRequestInfo,
  ReviewIssue,
  ReviewMode,
} from '../types';
import { GitService } from './git.service';

@Injectable()
export class PublishService {
  private readonly logger = new Logger(PublishService.name);
  private readonly httpClient: AxiosInstance;

  constructor(private readonly gitService: GitService) {
    this.httpClient = axios.create({
      timeout: 30000,
    });
  }

  /**
   * 发布评审结果
   */
  async publishReview(
    mrInfo: MergeRequestInfo,
    issues: ReviewIssue[],
    mode: ReviewMode,
    platform: GitPlatform,
    baseUrl: string,
    token: string,
    notifyWebhook?: string,
  ): Promise<void> {
    if (mode === ReviewMode.COMMENT) {
      await this.publishComments(mrInfo, issues, platform, baseUrl, token);
    } else {
      await this.publishReport(mrInfo, issues, platform, baseUrl, token);
    }

    // 发送企业通知
    if (notifyWebhook) {
      await this.sendNotification(notifyWebhook, mrInfo, issues);
    }
  }

  /**
   * 发布 Push 评审结果（发布到 commit）
   */
  async publishPushReview(
    mrInfo: MergeRequestInfo,
    issues: ReviewIssue[],
    mode: ReviewMode,
    platform: GitPlatform,
    baseUrl: string,
    token: string,
    commitSha: string,
    notifyWebhook?: string,
  ): Promise<void> {
    if (mode === ReviewMode.COMMENT) {
      await this.publishPushComments(mrInfo, issues, platform, baseUrl, token, commitSha);
    } else {
      await this.publishPushReport(mrInfo, issues, platform, baseUrl, token, commitSha);
    }

    // 发送企业通知
    if (notifyWebhook) {
      await this.sendPushNotification(notifyWebhook, mrInfo, issues, commitSha);
    }
  }

  /**
   * 发布行级评论
   */
  private async publishComments(
    mrInfo: MergeRequestInfo,
    issues: ReviewIssue[],
    platform: GitPlatform,
    baseUrl: string,
    token: string,
  ): Promise<void> {
    this.logger.log(`Publishing ${issues.length} comments to ${platform}`);

    for (const issue of issues) {
      const commentBody = this.formatComment(issue);

      try {
        if (platform === GitPlatform.GITLAB) {
          await this.gitService.postCommentToGitLab(
            mrInfo,
            baseUrl,
            token,
            commentBody,
            issue.line,
            issue.file,
          );
        } else {
          await this.gitService.postCommentToGitHub(
            mrInfo,
            baseUrl,
            token,
            commentBody,
            issue.line,
            issue.file,
          );
        }

        // 避免请求过快
        await this.sleep(500);
      } catch (error: any) {
        this.logger.error(`Failed to post comment for issue at ${issue.file}:${issue.line}: ${error.message}`);
      }
    }
  }

  /**
   * 发布完整报告
   */
  private async publishReport(
    mrInfo: MergeRequestInfo,
    issues: ReviewIssue[],
    platform: GitPlatform,
    baseUrl: string,
    token: string,
  ): Promise<void> {
    this.logger.log(`Publishing report with ${issues.length} issues to ${platform}`);

    const reportBody = this.formatReport(mrInfo, issues);

    try {
      if (platform === GitPlatform.GITLAB) {
        await this.gitService.postCommentToGitLab(mrInfo, baseUrl, token, reportBody);
      } else {
        await this.gitService.postCommentToGitHub(mrInfo, baseUrl, token, reportBody);
      }
    } catch (error: any) {
      this.logger.error(`Failed to post report: ${error.message}`);
      throw error;
    }
  }

  /**
   * 格式化评论（表格格式）
   */
  private formatComment(issue: ReviewIssue): string {
    const severityEmoji = this.getSeverityEmoji(issue.type);
    
    return `## ${severityEmoji} ${issue.title}

**类型**: ${issue.type.toUpperCase()}
**位置**: \`${issue.file}:${issue.line}\`

**问题描述**:
${issue.description}

${issue.suggestion ? `**建议**:\n${issue.suggestion}\n` : ''}
${issue.code ? `**相关代码**:\n\`\`\`\n${issue.code}\n\`\`\`\n` : ''}`;
  }

  /**
   * 格式化报告（完整表格）
   */
  private formatReport(mrInfo: MergeRequestInfo, issues: ReviewIssue[]): string {
    const criticalCount = issues.filter(i => i.type === 'critical').length;
    const warningCount = issues.filter(i => i.type === 'warning').length;
    const infoCount = issues.filter(i => i.type === 'info').length;

    let report = `# 🤖 AI 代码评审报告

**MR**: [${mrInfo.mrId}](${mrInfo.mrUrl})
**源分支**: \`${mrInfo.sourceBranch}\` → **目标分支**: \`${mrInfo.targetBranch}\`

## 📊 问题统计

| 严重性 | 数量 |
|--------|------|
| ● Critical | ${criticalCount} |
| ○ Warning | ${warningCount} |
| • Info | ${infoCount} |
| **总计** | **${issues.length}** |

`;

    if (issues.length === 0) {
      report += '\n✅ 未发现任何问题，代码质量良好！\n';
      return report;
    }

    report += '\n## 📋 问题清单\n\n';

    // 按严重性分组
    const criticalIssues = issues.filter(i => i.type === 'critical');
    const warningIssues = issues.filter(i => i.type === 'warning');
    const infoIssues = issues.filter(i => i.type === 'info');

    if (criticalIssues.length > 0) {
      report += '### ● Critical 问题\n\n';
      report += this.formatIssuesTable(criticalIssues, mrInfo);
      report += '\n';
    }

    if (warningIssues.length > 0) {
      report += '### ○ Warning 问题\n\n';
      report += this.formatIssuesTable(warningIssues, mrInfo);
      report += '\n';
    }

    if (infoIssues.length > 0) {
      report += '### • Info 提示\n\n';
      report += this.formatIssuesTable(infoIssues, mrInfo);
      report += '\n';
    }

    return report;
  }

  /**
   * 格式化问题表格
   */
  private formatIssuesTable(issues: ReviewIssue[], mrInfo: MergeRequestInfo): string {
    let table = '| 文件位置 | 问题描述 | 代码预览 |\n';
    table += '|---------|---------|---------|\n';

    for (const issue of issues) {
      const fileLink = this.getFileLink(issue.file, issue.line, mrInfo);
      const description = issue.description.replace(/\n/g, '<br>');
      const codePreview = issue.code
        ? `\`\`\`\n${issue.code.substring(0, 100)}${issue.code.length > 100 ? '...' : ''}\n\`\`\``
        : '-';

      table += `| ${fileLink} | ${description} | ${codePreview} |\n`;
    }

    return table;
  }

  /**
   * 获取文件链接
   */
  private getFileLink(file: string, line: number, mrInfo: MergeRequestInfo): string {
    // 根据平台生成文件链接
    // 这里简化处理，实际应该根据平台生成正确的链接
    return `[\`${file}:${line}\`](${mrInfo.mrUrl})`;
  }

  /**
   * 获取严重性图标
   */
  private getSeverityEmoji(type: string): string {
    switch (type) {
      case 'critical':
        return '●';
      case 'warning':
        return '○';
      case 'info':
        return '•';
      default:
        return '○';
    }
  }

  /**
   * 发送企业通知
   */
  private async sendNotification(
    webhookUrl: string,
    mrInfo: MergeRequestInfo,
    issues: ReviewIssue[],
  ): Promise<void> {
    const criticalCount = issues.filter(i => i.type === 'critical').length;
    const warningCount = issues.filter(i => i.type === 'warning').length;
    const infoCount = issues.filter(i => i.type === 'info').length;

    // 企业微信支持 markdown 和 text 两种格式
    // 优先使用 markdown，如果失败则降级为 text
    const markdownContent = `# AI 代码评审完成

**项目**: ${mrInfo.projectName}
**MR**: [#${mrInfo.mrId}](${mrInfo.mrUrl})
**分支**: ${mrInfo.sourceBranch} → ${mrInfo.targetBranch}

**问题统计**:
- ● Critical: ${criticalCount}
- ○ Warning: ${warningCount}
- • Info: ${infoCount}
- **总计**: ${issues.length}

[查看详情](${mrInfo.mrUrl})`;

    const textContent = `AI 代码评审完成

项目: ${mrInfo.projectName}
MR: #${mrInfo.mrId} ${mrInfo.mrUrl}
分支: ${mrInfo.sourceBranch} → ${mrInfo.targetBranch}

问题统计:
- ● Critical: ${criticalCount}
- ○ Warning: ${warningCount}
- • Info: ${infoCount}
- 总计: ${issues.length}`;

    // 先尝试发送 markdown 格式
    try {
      const markdownMessage = {
        msgtype: 'markdown',
        markdown: {
          content: markdownContent,
        },
      };

      const response = await this.httpClient.post(webhookUrl, markdownMessage, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // 检查响应是否成功
      if (response.data?.errcode === 0) {
        this.logger.log('Notification sent successfully (markdown)');
        return;
      } else {
        // 如果 markdown 失败，尝试 text 格式
        throw new Error(`Markdown format failed: ${response.data?.errmsg || 'Unknown error'}`);
      }
    } catch (error: any) {
      this.logger.warn(`Markdown notification failed, trying text format: ${error.message}`);

      // 降级为 text 格式
      try {
        const textMessage = {
          msgtype: 'text',
          text: {
            content: textContent,
          },
        };

        const response = await this.httpClient.post(webhookUrl, textMessage, {
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (response.data?.errcode === 0) {
          this.logger.log('Notification sent successfully (text)');
        } else {
          this.logger.error(`Text notification also failed: ${response.data?.errmsg || 'Unknown error'}`);
        }
      } catch (textError: any) {
        this.logger.error(`Failed to send notification: ${textError.message}`);
      }
    }
  }

  /**
   * 发布 Push 评论（Comment 模式）
   * 
   * 注意：
   * - GitLab: Commit API 不支持行级评论，每个 issue 会发布一条提交级评论（评论内容中包含位置信息）
   * - GitHub: 如果提供了 line 和 filePath，会发布行级评论；否则发布提交级评论
   * 
   * 与 MR/PR 的区别：
   * - MR/PR 可以使用 discussions API 实现真正的行级评论
   * - Commit 由于 API 限制，只能发布提交级评论，但评论内容中包含文件路径和行号
   */
  private async publishPushComments(
    mrInfo: MergeRequestInfo,
    issues: ReviewIssue[],
    platform: GitPlatform,
    baseUrl: string,
    token: string,
    commitSha: string,
  ): Promise<void> {
    this.logger.log(`Publishing ${issues.length} comments to ${platform} commit ${commitSha}`);

    for (const issue of issues) {
      const commentBody = this.formatComment(issue);

      try {
        if (platform === GitPlatform.GITLAB) {
          await this.gitService.postCommentToGitLabCommit(
            mrInfo,
            baseUrl,
            token,
            commitSha,
            commentBody,
            issue.line,
            issue.file,
          );
        } else {
          await this.gitService.postCommentToGitHubCommit(
            mrInfo,
            baseUrl,
            token,
            commitSha,
            commentBody,
            issue.line,
            issue.file,
          );
        }

        // 避免请求过快
        await this.sleep(500);
      } catch (error: any) {
        this.logger.error(`Failed to post comment for issue at ${issue.file}:${issue.line}: ${error.message}`);
      }
    }
  }

  /**
   * 发布 Push 完整报告
   */
  private async publishPushReport(
    mrInfo: MergeRequestInfo,
    issues: ReviewIssue[],
    platform: GitPlatform,
    baseUrl: string,
    token: string,
    commitSha: string,
  ): Promise<void> {
    this.logger.log(`Publishing report with ${issues.length} issues to ${platform} commit ${commitSha.substring(0, 8)}`);

    const reportBody = this.formatPushReport(mrInfo, issues, commitSha);
    this.logger.debug(`Report body length: ${reportBody.length} characters`);

    try {
      if (platform === GitPlatform.GITLAB) {
        this.logger.debug(`Posting to GitLab commit: ${commitSha.substring(0, 8)}`);
        await this.gitService.postCommentToGitLabCommit(mrInfo, baseUrl, token, commitSha, reportBody);
        this.logger.log(`Successfully posted report to GitLab commit ${commitSha.substring(0, 8)}`);
      } else {
        this.logger.debug(`Posting to GitHub commit: ${commitSha.substring(0, 8)}`);
        await this.gitService.postCommentToGitHubCommit(mrInfo, baseUrl, token, commitSha, reportBody);
        this.logger.log(`Successfully posted report to GitHub commit ${commitSha.substring(0, 8)}`);
      }
    } catch (error: any) {
      this.logger.error(`Failed to post push report: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * 格式化 Push 报告
   */
  private formatPushReport(mrInfo: MergeRequestInfo, issues: ReviewIssue[], commitSha: string): string {
    const criticalCount = issues.filter(i => i.type === 'critical').length;
    const warningCount = issues.filter(i => i.type === 'warning').length;
    const infoCount = issues.filter(i => i.type === 'info').length;

    let report = `# 🤖 AI 代码评审报告（Push）

**Commit**: [${commitSha.substring(0, 8)}](${mrInfo.mrUrl})
**分支**: \`${mrInfo.sourceBranch}\`

## 📊 问题统计

| 严重性 | 数量 |
|--------|------|
| ● Critical | ${criticalCount} |
| ○ Warning | ${warningCount} |
| • Info | ${infoCount} |
| **总计** | **${issues.length}** |

`;

    if (issues.length === 0) {
      report += '\n✅ 未发现任何问题，代码质量良好！\n';
      return report;
    }

    report += '\n## 📋 问题清单\n\n';

    // 按严重性分组
    const criticalIssues = issues.filter(i => i.type === 'critical');
    const warningIssues = issues.filter(i => i.type === 'warning');
    const infoIssues = issues.filter(i => i.type === 'info');

    if (criticalIssues.length > 0) {
      report += '### ● Critical 问题\n\n';
      report += this.formatIssuesTable(criticalIssues, mrInfo);
      report += '\n';
    }

    if (warningIssues.length > 0) {
      report += '### ○ Warning 问题\n\n';
      report += this.formatIssuesTable(warningIssues, mrInfo);
      report += '\n';
    }

    if (infoIssues.length > 0) {
      report += '### • Info 提示\n\n';
      report += this.formatIssuesTable(infoIssues, mrInfo);
      report += '\n';
    }

    return report;
  }

  /**
   * 发送 Push 企业通知
   */
  private async sendPushNotification(
    webhookUrl: string,
    mrInfo: MergeRequestInfo,
    issues: ReviewIssue[],
    commitSha: string,
  ): Promise<void> {
    const criticalCount = issues.filter(i => i.type === 'critical').length;
    const warningCount = issues.filter(i => i.type === 'warning').length;
    const infoCount = issues.filter(i => i.type === 'info').length;

    const markdownContent = `# AI 代码评审完成（Push）

**项目**: ${mrInfo.projectName}
**Commit**: [${commitSha.substring(0, 8)}](${mrInfo.mrUrl})
**分支**: ${mrInfo.sourceBranch}

**问题统计**:
- ● Critical: ${criticalCount}
- ○ Warning: ${warningCount}
- • Info: ${infoCount}
- **总计**: ${issues.length}

[查看详情](${mrInfo.mrUrl})`;

    const textContent = `AI 代码评审完成（Push）

项目: ${mrInfo.projectName}
Commit: ${commitSha.substring(0, 8)} ${mrInfo.mrUrl}
分支: ${mrInfo.sourceBranch}

问题统计:
- ● Critical: ${criticalCount}
- ○ Warning: ${warningCount}
- • Info: ${infoCount}
- 总计: ${issues.length}`;

    // 先尝试发送 markdown 格式
    try {
      const markdownMessage = {
        msgtype: 'markdown',
        markdown: {
          content: markdownContent,
        },
      };

      const response = await this.httpClient.post(webhookUrl, markdownMessage, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.data?.errcode === 0) {
        this.logger.log('Push notification sent successfully (markdown)');
        return;
      } else {
        throw new Error(`Markdown format failed: ${response.data?.errmsg || 'Unknown error'}`);
      }
    } catch (error: any) {
      this.logger.warn(`Markdown notification failed, trying text format: ${error.message}`);

      try {
        const textMessage = {
          msgtype: 'text',
          text: {
            content: textContent,
          },
        };

        const response = await this.httpClient.post(webhookUrl, textMessage, {
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (response.data?.errcode === 0) {
          this.logger.log('Push notification sent successfully (text)');
        } else {
          this.logger.error(`Text notification also failed: ${response.data?.errmsg || 'Unknown error'}`);
        }
      } catch (textError: any) {
        this.logger.error(`Failed to send push notification: ${textError.message}`);
      }
    }
  }

  /**
   * 睡眠函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

