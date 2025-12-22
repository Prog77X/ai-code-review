# 多阶段构建 Dockerfile

# 阶段 1: 构建阶段
FROM node:20-alpine AS builder

WORKDIR /app

# 复制 package 文件
COPY package*.json ./
COPY tsconfig.json ./
COPY nest-cli.json ./

# 安装依赖（包括开发依赖）
# 使用 --legacy-peer-deps 处理可能的 peer dependency 冲突
RUN npm ci --legacy-peer-deps || npm install --legacy-peer-deps

# 复制源代码
COPY . .

# 构建应用
RUN npm run build

# 阶段 2: 生产阶段
FROM node:20-alpine AS production

WORKDIR /app

# 安装生产依赖
COPY package*.json ./
RUN npm ci --only=production --legacy-peer-deps || npm install --only=production --legacy-peer-deps && npm cache clean --force

# 从构建阶段复制构建产物
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prompts ./prompts

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

# 更改文件所有者
RUN chown -R nestjs:nodejs /app
USER nestjs

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000', (r) => {process.exit(r.statusCode ? 0 : 1)}).on('error', () => process.exit(1))"

# 启动应用
CMD ["node", "dist/main.js"]
