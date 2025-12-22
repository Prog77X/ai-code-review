/**
 * GitHub Webhook 和 API 类型定义
 */

/**
 * GitHub Webhook Pull Request 事件
 */
export interface GitHubPullRequestEvent {
  action: string;
  number: number;
  pull_request: {
    id: number;
    number: number;
    title: string;
    body: string;
    state: string;
    head: {
      ref: string;
      sha: string;
      repo: {
        full_name: string;
        owner: {
          login: string;
        };
      };
    };
    base: {
      ref: string;
      repo: {
        full_name: string;
        owner: {
          login: string;
        };
      };
    };
    html_url: string;
    user: {
      login: string;
    };
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
    owner: {
      login: string;
    };
  };
}

/**
 * GitHub Pull Request Diff 文件
 */
export interface GitHubPullRequestFile {
  sha: string;
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed';
  additions: number;
  deletions: number;
  changes: number;
  blob_url: string;
  raw_url: string;
  contents_url: string;
  patch?: string;
  previous_filename?: string;
}

/**
 * GitHub Push Webhook 事件
 */
export interface GitHubPushEvent {
  ref: string; // 分支引用，如 'refs/heads/main'
  before: string; // 之前的 commit SHA
  after: string; // 当前的 commit SHA
  created: boolean; // 是否创建了新分支
  deleted: boolean; // 是否删除了分支
  forced: boolean; // 是否强制推送
  base_ref: string | null; // base ref
  compare: string; // compare URL
  commits: Array<{
    id: string;
    tree_id: string;
    distinct: boolean;
    message: string;
    timestamp: string;
    url: string;
    author: {
      name: string;
      email: string;
      username: string;
    };
    committer: {
      name: string;
      email: string;
      username: string;
    };
    added: string[];
    removed: string[];
    modified: string[];
  }>;
  head_commit: {
    id: string;
    tree_id: string;
    distinct: boolean;
    message: string;
    timestamp: string;
    url: string;
    author: {
      name: string;
      email: string;
      username: string;
    };
    committer: {
      name: string;
      email: string;
      username: string;
    };
    added: string[];
    removed: string[];
    modified: string[];
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
    owner: {
      name: string;
      email: string;
      login: string;
      id: number;
    };
    private: boolean;
    html_url: string;
    description: string;
    fork: boolean;
    url: string;
    created_at: number;
    updated_at: string;
    pushed_at: number;
    default_branch: string;
  };
  pusher: {
    name: string;
    email: string;
  };
  sender: {
    login: string;
    id: number;
  };
}

