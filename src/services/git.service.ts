/**
 * Git 服务提供者
 */
import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import {
  GitPlatform,
  MergeRequestInfo,
  FileChange,
  GitApiResponse,
  GitLabMergeRequestDiff,
  GitLabDiffRefs,
  GitLabMergeRequestChanges,
  GitLabWebhookEvent,
  GitLabPushEvent,
  GitHubPullRequestEvent,
  GitHubPushEvent,
  GitHubPullRequestFile,
} from '../types';
import { isCodeFile } from '../utils/file.util';

@Injectable()
export class GitService {
  private readonly logger = new Logger(GitService.name);
  private readonly httpClients: Map<string, AxiosInstance> = new Map();
  private readonly cachedDiffRefs: Map<string, GitLabDiffRefs> = new Map(); // 缓存 diff_refs

  /**
   * 获取或创建 HTTP 客户端
   */
  private getHttpClient(baseUrl: string, token: string): AxiosInstance {
    const key = `${baseUrl}:${token.substring(0, 10)}`;
    
    if (!this.httpClients.has(key)) {
      // 检查是否需要跳过 SSL 验证（用于内部 GitLab 实例）
      const skipSslVerify = process.env.GIT_SKIP_SSL_VERIFY === 'true' || 
                            process.env.NODE_ENV === 'development';
      
      const httpsAgent = skipSslVerify ? new https.Agent({ rejectUnauthorized: false }) : undefined;
      
      const client = axios.create({
        baseURL: baseUrl,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
        httpsAgent,
      });
      
      this.httpClients.set(key, client);
      
      if (skipSslVerify) {
        this.logger.warn(`SSL verification disabled for ${baseUrl} (development mode or GIT_SKIP_SSL_VERIFY=true)`);
      }
    }

    return this.httpClients.get(key)!;
  }

  /**
   * 从 Webhook 事件解析 MR 信息
   */
  parseMergeRequestInfo(
    event: GitLabWebhookEvent | GitHubPullRequestEvent,
    platform: GitPlatform,
  ): MergeRequestInfo {
    if (platform === GitPlatform.GITLAB) {
      return this.parseGitLabMRInfo(event as GitLabWebhookEvent);
    } else {
      return this.parseGitHubPRInfo(event as GitHubPullRequestEvent);
    }
  }

  /**
   * 从 Push 事件解析信息（用于 push 评审）
   */
  parsePushInfo(
    event: GitLabPushEvent | GitHubPushEvent,
    platform: GitPlatform,
  ): MergeRequestInfo {
    if (platform === GitPlatform.GITLAB) {
      return this.parseGitLabPushInfo(event as GitLabPushEvent);
    } else {
      return this.parseGitHubPushInfo(event as GitHubPushEvent);
    }
  }

  /**
   * 解析 GitLab MR 信息
   */
  private parseGitLabMRInfo(event: GitLabWebhookEvent): MergeRequestInfo {
    const projectPath = event.project.path_with_namespace;
    const [username, ...projectParts] = projectPath.split('/');
    const projectName = projectParts.join('/');

    return {
      username,
      projectName,
      sourceBranch: event.object_attributes.source_branch,
      targetBranch: event.object_attributes.target_branch,
      mrId: event.object_attributes.iid.toString(),
      projectId: event.project.id.toString(),
      mrUrl: event.object_attributes.url,
    };
  }

  /**
   * 解析 GitHub PR 信息
   */
  private parseGitHubPRInfo(event: GitHubPullRequestEvent): MergeRequestInfo {
    const [username, projectName] = event.repository.full_name.split('/');

    return {
      username,
      projectName,
      sourceBranch: event.pull_request.head.ref,
      targetBranch: event.pull_request.base.ref,
      mrId: event.pull_request.number.toString(),
      projectId: event.repository.id.toString(),
      mrUrl: event.pull_request.html_url,
    };
  }

  /**
   * 解析 GitLab Push 信息
   */
  private parseGitLabPushInfo(event: GitLabPushEvent): MergeRequestInfo {
    const projectPath = event.project.path_with_namespace;
    const [username, ...projectParts] = projectPath.split('/');
    const projectName = projectParts.join('/');
    const branch = event.ref.replace('refs/heads/', '');
    const commitSha = event.after;
    const commitMessage = event.commits[0]?.message || '';

    return {
      username,
      projectName,
      sourceBranch: branch,
      targetBranch: branch, // Push 事件没有目标分支，使用相同分支
      mrId: commitSha.substring(0, 8), // 使用 commit SHA 前8位作为 ID
      projectId: event.project.id.toString(),
      mrUrl: `${event.project.web_url}/-/commit/${commitSha}`,
      commitMessage,
    };
  }

  /**
   * 解析 GitHub Push 信息
   */
  private parseGitHubPushInfo(event: GitHubPushEvent): MergeRequestInfo {
    const [username, projectName] = event.repository.full_name.split('/');
    const branch = event.ref.replace('refs/heads/', '');
    const commitSha = event.after;
    const commitMessage = event.head_commit?.message || '';

    return {
      username,
      projectName,
      sourceBranch: branch,
      targetBranch: branch, // Push 事件没有目标分支，使用相同分支
      mrId: commitSha.substring(0, 8), // 使用 commit SHA 前8位作为 ID
      projectId: event.repository.id.toString(),
      mrUrl: event.head_commit?.url || event.compare,
      commitMessage,
    };
  }

  /**
   * 获取 MR 的变更文件列表和 diff
   */
  async getMergeRequestChanges(
    mrInfo: MergeRequestInfo,
    platform: GitPlatform,
    baseUrl: string,
    token: string,
    supportedExtensions: string[],
  ): Promise<FileChange[]> {
    if (platform === GitPlatform.GITLAB) {
      return this.getGitLabMRChanges(mrInfo, baseUrl, token, supportedExtensions);
    } else {
      return this.getGitHubPRChanges(mrInfo, baseUrl, token, supportedExtensions);
    }
  }

  /**
   * 获取 Push 事件的变更文件列表和 diff
   */
  async getPushChanges(
    mrInfo: MergeRequestInfo,
    platform: GitPlatform,
    baseUrl: string,
    token: string,
    supportedExtensions: string[],
    beforeSha: string,
    afterSha: string,
  ): Promise<FileChange[]> {
    if (platform === GitPlatform.GITLAB) {
      return this.getGitLabPushChanges(mrInfo, baseUrl, token, supportedExtensions, beforeSha, afterSha);
    } else {
      return this.getGitHubPushChanges(mrInfo, baseUrl, token, supportedExtensions, beforeSha, afterSha);
    }
  }

  /**
   * 获取 GitLab MR 变更
   */
  private async getGitLabMRChanges(
    mrInfo: MergeRequestInfo,
    baseUrl: string,
    token: string,
    supportedExtensions: string[],
  ): Promise<FileChange[]> {
    const client = this.getHttpClient(baseUrl, token);
    // GitLab API 需要使用 URL 编码的项目路径，格式：namespace%2Fproject
    // 例如：root/easm_fe_portal -> root%2Feasm_fe_portal
    const projectPath = encodeURIComponent(`${mrInfo.username}/${mrInfo.projectName}`);
    const url = `/projects/${projectPath}/merge_requests/${mrInfo.mrId}/changes`;

    try {
      const response = await client.get<{ changes: GitLabMergeRequestDiff[] }>(url);
      const changes = response.data.changes || [];

      const fileChanges: FileChange[] = [];

      for (const change of changes) {
        // 过滤非代码文件
        if (!isCodeFile(change.new_path || change.old_path, supportedExtensions)) {
          continue;
        }

        // 跳过删除的文件
        if (change.deleted_file) {
          continue;
        }

        fileChanges.push({
          oldPath: change.old_path,
          newPath: change.new_path,
          diff: change.diff,
          additions: this.countAdditions(change.diff),
          deletions: this.countDeletions(change.diff),
        });
      }

      return fileChanges;
    } catch (error: any) {
      this.logger.error(`Failed to get GitLab MR changes: ${error.message}`);
      throw new Error(`GitLab API error: ${error.response?.status || error.message}`);
    }
  }

  /**
   * 获取 GitHub PR 变更
   */
  private async getGitHubPRChanges(
    mrInfo: MergeRequestInfo,
    baseUrl: string,
    token: string,
    supportedExtensions: string[],
  ): Promise<FileChange[]> {
    const client = this.getHttpClient(baseUrl, token);
    const url = `/repos/${mrInfo.username}/${mrInfo.projectName}/pulls/${mrInfo.mrId}/files`;

    try {
      const response = await client.get<GitHubPullRequestFile[]>(url);
      const files = response.data || [];

      const fileChanges: FileChange[] = [];

      for (const file of files) {
        // 过滤非代码文件
        if (!isCodeFile(file.filename, supportedExtensions)) {
          continue;
        }

        // 跳过删除的文件
        if (file.status === 'removed') {
          continue;
        }

        // 获取文件 diff
        let diff = file.patch || '';
        if (!diff && file.contents_url) {
          // 如果没有 patch，尝试获取文件内容
          try {
            const contentResponse = await client.get(file.contents_url);
            diff = contentResponse.data.content || '';
          } catch (e) {
            this.logger.warn(`Failed to get file content for ${file.filename}`);
          }
        }

        fileChanges.push({
          oldPath: file.previous_filename || file.filename,
          newPath: file.filename,
          diff,
          additions: file.additions,
          deletions: file.deletions,
        });
      }

      return fileChanges;
    } catch (error: any) {
      this.logger.error(`Failed to get GitHub PR changes: ${error.message}`);
      throw new Error(`GitHub API error: ${error.response?.status || error.message}`);
    }
  }

  /**
   * 发布评论到 GitLab MR
   * 支持行级评论（使用 discussions API）和通用评论（使用 notes API）
   */
  async postCommentToGitLab(
    mrInfo: MergeRequestInfo,
    baseUrl: string,
    token: string,
    body: string,
    line?: number,
    filePath?: string,
  ): Promise<void> {
    const client = this.getHttpClient(baseUrl, token);
    const projectPath = encodeURIComponent(`${mrInfo.username}/${mrInfo.projectName}`);

    // 如果是行级评论，使用 discussions API
    if (line && filePath) {
      await this.postLineCommentToGitLab(mrInfo, baseUrl, token, body, line, filePath);
      return;
    }

    // 通用评论使用 notes API
    const url = `/projects/${projectPath}/merge_requests/${mrInfo.mrId}/notes`;
    try {
      await client.post(url, { body });
      this.logger.log(`Posted general comment to GitLab MR ${mrInfo.mrId}`);
    } catch (error: any) {
      this.logger.error(`Failed to post comment to GitLab: ${error.message}`);
      throw new Error(`GitLab API error: ${error.response?.status || error.message}`);
    }
  }

  /**
   * 发布行级评论到 GitLab MR（使用 discussions API）
   */
  private async postLineCommentToGitLab(
    mrInfo: MergeRequestInfo,
    baseUrl: string,
    token: string,
    body: string,
    line: number,
    filePath: string,
  ): Promise<void> {
    const client = this.getHttpClient(baseUrl, token);
    const projectPath = encodeURIComponent(`${mrInfo.username}/${mrInfo.projectName}`);
    
    // 获取 diff_refs（从缓存或重新获取）
    let diffRefs = this.cachedDiffRefs.get(`${mrInfo.projectId}-${mrInfo.mrId}`);
    
    if (!diffRefs) {
      // 如果没有缓存，重新获取
      try {
        const changesUrl = `/projects/${projectPath}/merge_requests/${mrInfo.mrId}/changes`;
        const changesResponse = await client.get<GitLabMergeRequestChanges>(changesUrl);
        diffRefs = changesResponse.data.diff_refs;
        if (diffRefs) {
          this.cachedDiffRefs.set(`${mrInfo.projectId}-${mrInfo.mrId}`, diffRefs);
        }
      } catch (error: any) {
        this.logger.warn(`Failed to get diff_refs, falling back to general comment: ${error.message}`);
        // 如果获取失败，降级为通用评论
        await this.postCommentToGitLab(mrInfo, baseUrl, token, body);
        return;
      }
    }

    if (!diffRefs) {
      this.logger.warn('diff_refs not available, falling back to general comment');
      await this.postCommentToGitLab(mrInfo, baseUrl, token, body);
      return;
    }

    // 使用 discussions API 发布行级评论
    const url = `/projects/${projectPath}/merge_requests/${mrInfo.mrId}/discussions`;
    
    // 判断是新文件还是修改的文件（简化处理，假设是修改的文件）
    const position = {
      position_type: 'text',
      base_sha: diffRefs.base_sha,
      head_sha: diffRefs.head_sha,
      start_sha: diffRefs.start_sha,
      new_path: filePath,
      old_path: filePath,
      new_line: line, // 对于新增的行使用 new_line
    };

    try {
      const response = await client.post(url, {
        body,
        position,
      });
      
      this.logger.log(`Posted line comment to GitLab MR ${mrInfo.mrId}, file: ${filePath}, line: ${line}`);
    } catch (error: any) {
      this.logger.error(`Failed to post line comment to GitLab: ${error.message}`);
      // 如果行级评论失败，尝试降级为通用评论
      this.logger.warn('Falling back to general comment');
      try {
        await this.postCommentToGitLab(mrInfo, baseUrl, token, body);
      } catch (fallbackError: any) {
        throw new Error(`GitLab API error: ${error.response?.status || error.message}`);
      }
    }
  }

  /**
   * 发布评论到 GitHub PR
   */
  async postCommentToGitHub(
    mrInfo: MergeRequestInfo,
    baseUrl: string,
    token: string,
    body: string,
    line?: number,
    filePath?: string,
  ): Promise<void> {
    const client = this.getHttpClient(baseUrl, token);
    
    // 如果是行级评论，需要先获取 commit SHA
    if (line && filePath) {
      // 获取 PR 的 commits
      const commitsUrl = `/repos/${mrInfo.username}/${mrInfo.projectName}/pulls/${mrInfo.mrId}/commits`;
      const commitsResponse = await client.get<any[]>(commitsUrl);
      const commitSha = commitsResponse.data[0]?.sha;

      if (commitSha) {
        const reviewUrl = `/repos/${mrInfo.username}/${mrInfo.projectName}/pulls/${mrInfo.mrId}/comments`;
        await client.post(reviewUrl, {
          body,
          commit_id: commitSha,
          path: filePath,
          line,
          side: 'RIGHT',
        });
        return;
      }
    }

    // 通用评论
    const url = `/repos/${mrInfo.username}/${mrInfo.projectName}/issues/${mrInfo.mrId}/comments`;
    await client.post(url, { body });
  }

  /**
   * 统计新增行数
   */
  private countAdditions(diff: string): number {
    return (diff.match(/^\+/gm) || []).length;
  }

  /**
   * 获取 GitLab Push 变更
   */
  private async getGitLabPushChanges(
    mrInfo: MergeRequestInfo,
    baseUrl: string,
    token: string,
    supportedExtensions: string[],
    beforeSha: string,
    afterSha: string,
  ): Promise<FileChange[]> {
    const client = this.getHttpClient(baseUrl, token);
    const projectPath = encodeURIComponent(`${mrInfo.username}/${mrInfo.projectName}`);
    const url = `/projects/${projectPath}/repository/compare?from=${beforeSha}&to=${afterSha}`;

    try {
      const response = await client.get<{ commits: any[]; diffs: GitLabMergeRequestDiff[] }>(url);
      const diffs = response.data.diffs || [];

      const fileChanges: FileChange[] = [];

      for (const diff of diffs) {
        // 过滤非代码文件
        if (!isCodeFile(diff.new_path || diff.old_path, supportedExtensions)) {
          continue;
        }

        // 跳过删除的文件
        if (diff.deleted_file) {
          continue;
        }

        fileChanges.push({
          oldPath: diff.old_path,
          newPath: diff.new_path,
          diff: diff.diff,
          additions: this.countAdditions(diff.diff),
          deletions: this.countDeletions(diff.diff),
        });
      }

      return fileChanges;
    } catch (error: any) {
      this.logger.error(`Failed to get GitLab push changes: ${error.message}`);
      throw new Error(`GitLab API error: ${error.response?.status || error.message}`);
    }
  }

  /**
   * 获取 GitHub Push 变更
   */
  private async getGitHubPushChanges(
    mrInfo: MergeRequestInfo,
    baseUrl: string,
    token: string,
    supportedExtensions: string[],
    beforeSha: string,
    afterSha: string,
  ): Promise<FileChange[]> {
    const client = this.getHttpClient(baseUrl, token);
    const url = `/repos/${mrInfo.username}/${mrInfo.projectName}/compare/${beforeSha}...${afterSha}`;

    try {
      const response = await client.get<{ files: GitHubPullRequestFile[] }>(url);
      const files = response.data.files || [];

      const fileChanges: FileChange[] = [];

      for (const file of files) {
        // 过滤非代码文件
        if (!isCodeFile(file.filename, supportedExtensions)) {
          continue;
        }

        // 跳过删除的文件
        if (file.status === 'removed') {
          continue;
        }

        fileChanges.push({
          oldPath: file.previous_filename || file.filename,
          newPath: file.filename,
          diff: file.patch || '',
          additions: file.additions,
          deletions: file.deletions,
        });
      }

      return fileChanges;
    } catch (error: any) {
      this.logger.error(`Failed to get GitHub push changes: ${error.message}`);
      throw new Error(`GitHub API error: ${error.response?.status || error.message}`);
    }
  }

  /**
   * 发布评论到 GitLab Commit
   */
  async postCommentToGitLabCommit(
    mrInfo: MergeRequestInfo,
    baseUrl: string,
    token: string,
    commitSha: string,
    body: string,
    line?: number,
    filePath?: string,
  ): Promise<void> {
    const client = this.getHttpClient(baseUrl, token);
    const projectPath = encodeURIComponent(`${mrInfo.username}/${mrInfo.projectName}`);
    
    // GitLab 不支持在 commit 上添加行级评论，只支持通用评论
    const url = `/projects/${projectPath}/repository/commits/${commitSha}/comments`;

    try {
      await client.post(url, { note: body });
    } catch (error: any) {
      this.logger.error(`Failed to post comment to GitLab commit: ${error.message}`);
      throw new Error(`GitLab API error: ${error.response?.status || error.message}`);
    }
  }

  /**
   * 发布评论到 GitHub Commit
   */
  async postCommentToGitHubCommit(
    mrInfo: MergeRequestInfo,
    baseUrl: string,
    token: string,
    commitSha: string,
    body: string,
    line?: number,
    filePath?: string,
  ): Promise<void> {
    const client = this.getHttpClient(baseUrl, token);
    
    // GitHub 支持在 commit 上添加行级评论
    if (line && filePath) {
      const url = `/repos/${mrInfo.username}/${mrInfo.projectName}/commits/${commitSha}/comments`;
      await client.post(url, {
        body,
        path: filePath,
        line,
        position: line, // GitHub 需要 position，这里简化使用 line
      });
    } else {
      const url = `/repos/${mrInfo.username}/${mrInfo.projectName}/commits/${commitSha}/comments`;
      await client.post(url, { body });
    }
  }

  /**
   * 统计删除行数
   */
  private countDeletions(diff: string): number {
    return (diff.match(/^-/gm) || []).length;
  }
}

