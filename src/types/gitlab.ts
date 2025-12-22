/**
 * GitLab Webhook 和 API 类型定义
 */

/**
 * GitLab Webhook 事件类型
 */
export interface GitLabWebhookEvent {
  object_kind: string;
  event_type?: string;
  user: {
    name: string;
    username: string;
  };
  project: {
    id: number;
    name: string;
    path_with_namespace: string;
    web_url: string;
  };
  object_attributes: {
    id: number;
    iid: number;
    title: string;
    description: string;
    state: string;
    merge_status: string;
    source_branch: string;
    target_branch: string;
    url: string;
    action?: string;
  };
  changes?: {
    [key: string]: {
      previous: any;
      current: any;
    };
  };
}

/**
 * GitLab Merge Request Diff 响应
 */
export interface GitLabMergeRequestDiff {
  old_path: string;
  new_path: string;
  a_mode: string;
  b_mode: string;
  diff: string;
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
}

/**
 * GitLab Diff Refs（用于行级评论定位）
 */
export interface GitLabDiffRefs {
  base_sha: string;
  head_sha: string;
  start_sha: string;
}

/**
 * GitLab Merge Request Changes 响应（包含 diff_refs）
 */
export interface GitLabMergeRequestChanges {
  changes: GitLabMergeRequestDiff[];
  diff_refs: GitLabDiffRefs;
}

/**
 * GitLab API 变更文件
 */
export interface GitLabChange {
  old_path: string;
  new_path: string;
  a_mode: string;
  b_mode: string;
  diff: string;
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
  too_large: boolean;
}

/**
 * GitLab Push Webhook 事件
 */
export interface GitLabPushEvent {
  object_kind: 'push';
  event_name: 'push';
  before: string; // 之前的 commit SHA
  after: string; // 当前的 commit SHA
  ref: string; // 分支引用，如 'refs/heads/main'
  checkout_sha: string; // checkout SHA
  user_id: number;
  user_name: string;
  user_username: string;
  user_email: string;
  user_avatar: string;
  project_id: number;
  project: {
    id: number;
    name: string;
    description: string;
    web_url: string;
    avatar_url: string | null;
    git_ssh_url: string;
    git_http_url: string;
    namespace: string;
    visibility_level: number;
    path_with_namespace: string;
    default_branch: string;
    homepage: string;
    url: string;
    ssh_url: string;
    http_url: string;
  };
  repository: {
    name: string;
    url: string;
    description: string;
    homepage: string;
    git_http_url: string;
    git_ssh_url: string;
    visibility_level: number;
  };
  commits: Array<{
    id: string;
    message: string;
    title: string;
    timestamp: string;
    url: string;
    author: {
      name: string;
      email: string;
    };
    added: string[];
    modified: string[];
    removed: string[];
  }>;
  total_commits_count: number;
}

