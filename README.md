# AI 代码评审服务

基于 NestJS 的 AI 代码评审服务，支持 GitLab 和 GitHub 的 Webhook 集成。自动分析 Merge Request/Push 中的代码变更，使用 AI 模型进行代码评审，并将评审结果发布回 Git 平台。

## 📸 效果展示

### GitLab 评审报告

![GitLab 评论示例](https://prog77x.github.io/ai-code-review/docs/images/review-gitlab.png)

### 企业微信通知

![企业微信通知示例](https://prog77x.github.io/ai-code-review/docs/images/review-wechat.png)

## ✨ 功能特性
- ✅ 接收 GitLab/GitHub Webhook 事件（支持 Merge Request 和 Push 事件）
- ✅ 自动分析 Merge Request/Push 中的代码变更
- ✅ 使用 AI 模型进行代码评审（支持 DeepSeek、OpenAI 等）
- ✅ 支持评论和报告两种模式
- ✅ AST 智能分析，提取最小代码块（最小包含块原则）
- ✅ Token 管理和限制
- ✅ 企业微信通知集成
- ✅ 防重复处理机制
- ✅ 支持内部 GitLab 实例（自签名证书）

## 🛠 技术栈

- **框架**: NestJS 11.x
- **语言**: TypeScript 5.7+
- **AST 解析**: @babel/parser + @babel/traverse
- **Token 计数**: @dqbd/tiktoken
- **YAML 解析**: js-yaml

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
# 或
pnpm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并配置：

```bash
cp .env.example .env
```

编辑 `.env` 文件，配置以下关键项：

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# DeepSeek AI Model Configuration
AI_API_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-chat
AI_API_KEY=your-deepseek-api-key

# GitLab Configuration
DEFAULT_GIT_PLATFORM=gitlab
DEFAULT_GIT_BASE_URL=https://gitlab.com/api/v4
DEFAULT_GIT_TOKEN=your-gitlab-token

# 企业微信 Webhook (可选)
DEFAULT_NOTIFY_WEBHOOK=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=your-key

# SSL Configuration (用于内部 GitLab 实例)
GIT_SKIP_SSL_VERIFY=true
```

### 3. 启动服务

```bash
# 开发模式
npm run start:dev

# 生产模式
npm run build
npm run start:prod
```

服务启动后，访问 `http://localhost:3000`，Webhook 端点：
- `POST /webhook/gitlab` - GitLab Webhook（支持 Merge Request 和 Push 事件）
- `POST /webhook/github` - GitHub Webhook（支持 Pull Request 和 Push 事件）

## 📋 配置说明

### GitLab Token 权限要求

GitLab Access Token 需要以下权限：
- ✅ `api` - 访问 GitLab API
- ✅ `read_repository` - 读取仓库内容

创建 Token 步骤：
1. 进入 GitLab → **Settings** → **Access Tokens**
2. 选择权限：`api`、`read_repository`
3. 复制生成的 Token，配置到 `.env` 文件的 `DEFAULT_GIT_TOKEN`

### 环境变量配置

#### AI 模型配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `AI_API_BASE_URL` | AI API 基础 URL | `https://api.openai.com/v1` |
| `AI_MODEL` | AI 模型名称 | `gpt-4-turbo-preview` |
| `AI_API_KEY` | AI API Key | - |
| `AI_MAX_TOKENS` | 最大 Token 数 | `4096` |
| `AI_TEMPERATURE` | 温度参数 | `0.3` |

#### GitLab 配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `DEFAULT_GIT_PLATFORM` | Git 平台类型 | `gitlab` |
| `DEFAULT_GIT_BASE_URL` | GitLab API 基础 URL | `https://gitlab.com/api/v4` |
| `DEFAULT_GIT_TOKEN` | GitLab Access Token | - |
| `GIT_SKIP_SSL_VERIFY` | 跳过 SSL 验证 | `false` |

#### Token 限制配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `MAX_INPUT_TOKENS` | 最大输入 Token 数 | `8000` |
| `RESERVED_OUTPUT_TOKENS` | 预留输出 Token 数 | `2000` |

#### AST 分析配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `AST_MAX_CHARS` | 代码块最大字符数 | `10000` |
| `AST_MAX_LINES` | 代码块最大行数 | `150` |
| `AST_TIMEOUT_MS` | AST 解析超时时间（毫秒） | `8000` |
| `AST_MAX_DEPTH` | 递归深度限制 | `60` |

#### 其他配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `WEBHOOK_RATE_LIMIT_MS` | Webhook 防重复处理时间窗口（毫秒） | `60000` |
| `SUPPORTED_EXTENSIONS` | 支持的文件扩展名（逗号分隔） | `ts,tsx,js,jsx,vue,py` |

## 🔗 Webhook 配置

### GitLab Webhook 配置

1. **进入项目设置**
   - 访问：`https://gitlab.com/root/your-project`
   - 进入 **Settings** → **Webhooks**

2. **添加 Webhook**
   - **URL**: `http://your-server-ip:3000/webhook/gitlab`
   - **Trigger**: 选择 **Merge request events** 和/或 **Push events**
   - **Secret token**: 可选

3. **自定义请求头**（可选，如果已在 `.env` 中配置）
   ```
   x-git-token: your-gitlab-token
   x-review-mode: report
   x-notify-webhook: https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=your-key
   x-git-platform: gitlab
   x-git-base-url: https://gitlab.com/api/v4
   ```

**注意**：如果已在 `.env` 文件中配置了默认值，Webhook 请求头可以只包含 `x-git-token`。

### GitHub Webhook 配置

1. 进入项目 **Settings** → **Webhooks**
2. URL: `http://your-server/webhook/github`
3. Events: 选择 **Pull requests** 和/或 **Pushes**
4. 添加自定义请求头（同上）

### Push 事件说明

- **GitLab**: 当代码推送到分支时，会自动触发评审
- **GitHub**: 当代码推送到分支时，会自动触发评审
- Push 事件的评审结果会发布到对应的 commit 评论中
- 支持多个 commit 的批量评审（比较 before 和 after SHA）

## 📝 Webhook 请求头配置

| 请求头 | 说明 | 必需 | 默认值 |
|--------|------|------|--------|
| `x-git-token` | Git 平台认证 Token | ✅ | `.env` 中的 `DEFAULT_GIT_TOKEN` |
| `x-review-mode` | 评审模式：`comment` 或 `report` | ❌ | `report` |
| `x-notify-webhook` | 企业通知 Webhook URL | ❌ | `.env` 中的 `DEFAULT_NOTIFY_WEBHOOK` |
| `x-git-platform` | Git 平台类型：`gitlab` 或 `github` | ❌ | `.env` 中的 `DEFAULT_GIT_PLATFORM` |
| `x-git-base-url` | Git 平台 API 基础 URL | ❌ | `.env` 中的 `DEFAULT_GIT_BASE_URL` |

**配置优先级**：Webhook 请求头 > 环境变量 > 代码默认值

## 🎯 评审模式

### Comment 模式

在每个问题对应的代码行上添加评论，包含：
- 问题标题和严重性
- 详细问题描述
- 改进建议
- 相关代码片段
注：
- MR/PR 可以使用 discussions API 实现行级评论
- Commit 由于 API 限制，只能发布提交级评论，但评论内容中包含文件路径和行号

### Report 模式

生成完整的问题清单表格，包含：
- 问题统计（按严重性分类：Critical、Warning、Info）
- 问题清单（表格格式）
- 代码位置链接
- 代码 diff 预览

## 📁 支持的文件类型

默认支持：`ts`, `tsx`, `js`, `jsx`, `vue`, `py`

可通过环境变量 `SUPPORTED_EXTENSIONS` 配置，格式：`ts,tsx,js,jsx,vue,py`

## 🔧 核心功能流程

1. **Webhook 接收** → 解析 GitLab/GitHub Webhook 事件和配置
2. **MR 信息提取** → 从 Webhook 事件中提取 MR 信息（项目、分支、MR ID 等）
3. **获取变更文件** → 调用 GitLab/GitHub API 获取变更文件列表和 diff
4. **文件过滤** → 过滤非代码文件（根据扩展名）
5. **Diff 解析** → 解析统一差异格式，添加真实行号映射
6. **AST 分析** → 提取包含新增行的最小代码块（最小包含块原则）
7. **Token 计算** → 检查是否超出 token 限制
8. **AI 评审** → 调用 AI 模型进行代码评审
9. **结果解析** → 解析 YAML 格式的评审结果
10. **结果发布** → 发布评论或报告到 GitLab/GitHub
11. **通知发送** → 发送企业微信通知（如果配置）

## 🧪 测试

### 使用 PowerShell 测试脚本

创建 `test-webhook.ps1`：

```powershell
$headers = @{
    "Content-Type" = "application/json"
    "x-git-token" = "your-gitlab-token"
    "x-review-mode" = "report"
    "x-git-base-url" = "https://gitlab.com/api/v4"
}

$body = @{
    object_kind = "merge_request"
    event_type = "merge_request"
    project = @{
        id = 1
        name = "your-project"
        path_with_namespace = "root/your-project"
    }
    object_attributes = @{
        iid = 1
        source_branch = "feature"
        target_branch = "main"
        url = "https://gitlab.com/root/your-project/-/merge_requests/1"
        action = "open"
    }
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Uri "http://localhost:3000/webhook/gitlab" -Method Post -Headers $headers -Body $body
```

### 使用 curl 测试

```bash
curl -X POST http://localhost:3000/webhook/gitlab \
  -H "Content-Type: application/json" \
  -H "x-git-token: your-gitlab-token" \
  -H "x-review-mode: report" \
  -H "x-git-base-url: https://gitlab.com/api/v4" \
  -d '{
    "object_kind": "merge_request",
    "project": {
      "id": 1,
      "path_with_namespace": "root/your-project"
    },
    "object_attributes": {
      "iid": 1,
      "source_branch": "feature",
      "target_branch": "main",
      "action": "open"
    }
  }'
```

## 🏗 项目结构

```
ai-code-review/
├── src/
│   ├── config/              # 配置模块
│   │   └── configuration.ts
│   ├── modules/             # 功能模块
│   │   └── webhook/        # Webhook 模块
│   │       ├── webhook.controller.ts
│   │       ├── webhook.service.ts
│   │       └── webhook.module.ts
│   ├── services/           # 核心服务
│   │   ├── git.service.ts          # Git 平台 API 调用
│   │   ├── diff.service.ts         # Diff 处理
│   │   ├── ast.service.ts          # AST 智能分析
│   │   ├── token.service.ts        # Token 管理
│   │   ├── prompt.service.ts       # 提示词管理
│   │   ├── ai-agent.service.ts     # AI Agent
│   │   └── publish.service.ts      # 发布服务
│   ├── types/              # 类型定义
│   │   ├── index.ts
│   │   ├── gitlab.ts
│   │   └── github.ts
│   ├── utils/              # 工具函数
│   │   └── file.util.ts
│   ├── app.module.ts       # 主应用模块
│   └── main.ts             # 应用入口
├── prompts/                # 提示词模板
│   └── system-prompt.txt
├── test/                   # 测试文件
├── .env.example            # 环境变量示例
├── package.json
├── tsconfig.json
└── README.md
```

## 🔍 故障排查

### GitLab API 调用失败

**问题**: 返回 404 或 401 错误

**解决方案**:
1. 检查 GitLab Token 是否正确配置
2. 确认 Token 有 `api` 和 `read_repository` 权限
3. 检查 GitLab API URL 是否正确（需要包含 `/api/v4`）
4. 确认项目路径格式正确（`root/project-name`）

### SSL 证书验证失败

**问题**: `unable to verify the first certificate`

**解决方案**:
- 开发环境：设置 `GIT_SKIP_SSL_VERIFY=true` 或 `NODE_ENV=development`
- 生产环境：建议使用有效的 SSL 证书

### AI API 调用失败

**问题**: AI API 返回错误

**解决方案**:
1. 检查 API Key 是否正确
2. 确认 API 地址正确（DeepSeek: `https://api.deepseek.com`）
3. 检查账户余额是否充足
4. 查看日志中的详细错误信息

### 企业微信通知失败

**问题**: 返回错误 93017（JSON 格式错误）

**解决方案**:
- 代码已自动处理，会降级为 text 格式
- 检查 Webhook URL 是否正确
- 查看日志中的详细错误信息

### 没有找到代码文件

**问题**: "No code files changed, skipping review"

**解决方案**:
1. 确认 MR 中确实有代码文件变更
2. 检查文件扩展名是否在支持列表中
3. 查看 GitLab API 返回的文件列表

## 📊 预期日志输出

成功处理 Webhook 时，你会看到类似以下日志：

![docker-logs](https://prog77x.github.io/ai-code-review/docs/images/docker-logs.png)

```
[WebhookController] Received GitLab webhook: merge_request
[WebhookService] Processing MR: 1 in your-project
[WebhookService] Found 10 changed files
[WebhookService] Starting review of 10 files...
[WebhookService] Progress: 10/10 files processed
[WebhookService] Completed review of 10 files, found 5 issues
[WebhookService] Review completed in 15000ms, found 5 issues
[PublishService] Publishing report with 5 issues to gitlab
[PublishService] Notification sent successfully (markdown)
```

## 🚀 部署指南

### 方式 1: Docker 部署（推荐）

Docker 部署提供环境一致性，适合生产环境。

#### 1. 构建 Docker 镜像

```bash
docker build -t ai-code-review:latest .
```

#### 2. 运行容器

```bash
docker run -d \
  --name ai-code-review \
  -p 3000:3000 \
  --env-file .env \
  --restart unless-stopped \
  ai-code-review:latest
```

#### 3. 查看日志

```bash
docker logs -f ai-code-review
```

#### Docker 常用命令

```bash
# 查看容器状态
docker ps

# 停止容器
docker stop ai-code-review

# 启动容器
docker start ai-code-review

# 重启容器
docker restart ai-code-review

# 删除容器
docker rm ai-code-review

# 查看日志
docker logs -f ai-code-review

# 进入容器
docker exec -it ai-code-review sh
```

#### Docker 部署优势

- ✅ **环境一致性** - 开发、测试、生产环境完全一致
- ✅ **易于管理** - 一键启动、停止、重启
- ✅ **资源隔离** - 容器化部署，不影响宿主机
- ✅ **快速部署** - 构建一次，到处运行
- ✅ **健康检查** - 自动监控服务状态
- ✅ **安全性** - 使用非 root 用户运行

#### 生产环境优化建议

**配置资源限制**：

```bash
docker run -d \
  --name ai-code-review \
  -p 3000:3000 \
  --memory="1g" \
  --cpus="1" \
  --env-file .env \
  --restart unless-stopped \
  ai-code-review:latest
```

**配置日志轮转**：

```bash
docker run -d \
  --name ai-code-review \
  -p 3000:3000 \
  --log-driver json-file \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  --env-file .env \
  --restart unless-stopped \
  ai-code-review:latest
```

### 方式 2: 直接部署

适合开发环境或已有 Node.js 环境的服务器。

#### 1. 构建项目

```bash
npm run build
```

#### 2. 使用 PM2 管理（生产环境推荐）

```bash
# 安装 PM2
npm install -g pm2

# 启动应用
pm2 start dist/main.js --name ai-code-review

# 查看日志
pm2 logs ai-code-review

# 查看状态
pm2 status

# 重启应用
pm2 restart ai-code-review

# 停止应用
pm2 stop ai-code-review

# 设置开机自启
pm2 startup
pm2 save
```

#### 3. 直接运行（不推荐生产环境）

```bash
npm run start:prod
```

## 📚 项目参考
- [mr-agent](https://github.com/zixingtangmouren/mr-agent): mr-agent: A Node.js service that auto-triggers AI-powered code reviews when receiving Git merge request webhook events. Integrates with GitHub/GitLab/Bitbucket to analyze changes, flag issues, and suggest improvements—streamlining reviews for teams of all sizes.
- [code-review-js](https://github.com/streaker303/code-review-js): 基于阿里云百炼平台和GitLab CI/CD的自动化代码审查工具，通过AST分析提取代码上下文，利用大语言模型识别代码质量问题。

## 📄 许可证

MIT

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！
