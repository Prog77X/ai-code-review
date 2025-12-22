/**
 * 应用配置
 */
import { AppConfig, GitPlatform } from '../types';

export default (): AppConfig => ({
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
    defaultBaseUrl: process.env.DEFAULT_GIT_BASE_URL || 'https://gitlab.com/api/v4',
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
  supportedExtensions: (process.env.SUPPORTED_EXTENSIONS || 'ts,tsx,js,jsx,vue,py').split(','),
  gitSkipSslVerify: process.env.GIT_SKIP_SSL_VERIFY === 'true',
});

