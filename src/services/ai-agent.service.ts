/**
 * AI Agent 服务
 */
import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import * as yaml from 'js-yaml';
import { AppConfig, ReviewResult } from '../types';

@Injectable()
export class AiAgentService {
  private readonly logger = new Logger(AiAgentService.name);
  private readonly httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({
      timeout: 120000, // 2 分钟超时
    });
  }

  /**
   * 调用 AI 模型 API（支持流式响应）
   */
  async reviewCode(
    prompt: string,
    config: AppConfig,
    maxRetries: number = 3,
  ): Promise<ReviewResult> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.callAiApi(prompt, config);
        const reviewResult = this.parseResponse(response);
        return reviewResult;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          `AI API call failed (attempt ${attempt}/${maxRetries}): ${error.message}`,
        );

        if (attempt < maxRetries) {
          // 指数退避
          const delay = Math.pow(2, attempt - 1) * 1000;
          await this.sleep(delay);
        }
      }
    }

    throw new Error(`AI API call failed after ${maxRetries} attempts: ${lastError?.message}`);
  }

  /**
   * 调用 AI API
   */
  private async callAiApi(prompt: string, config: AppConfig): Promise<string> {
    this.logger.debug(`Calling AI API: ${config.ai.apiBaseUrl}, model: ${config.ai.model}`);
    const url = `${config.ai.apiBaseUrl}/chat/completions`;
    const headers = {
      'Authorization': `Bearer ${config.ai.apiKey}`,
      'Content-Type': 'application/json',
    };

    const messages = [
      {
        role: 'system',
        content: '你是一位资深的代码评审专家。请仔细分析代码变更，并以 YAML 格式输出评审结果。',
      },
      {
        role: 'user',
        content: prompt,
      },
    ];

    const requestBody = {
      model: config.ai.model,
      messages,
      temperature: config.ai.temperature,
      max_tokens: config.ai.maxTokens,
      stream: false, // 非流式响应
    };

    try {
      this.logger.debug(`Sending request to AI API: ${url}`);
      const response = await this.httpClient.post(url, requestBody, { headers });
      const content = response.data.choices[0]?.message?.content;
      
      if (!content) {
        this.logger.error('AI API returned empty response');
        throw new Error('Empty response from AI API');
      }

      this.logger.debug(`AI API response received, content length: ${content.length}`);
      return content;
    } catch (error: any) {
      if (error.response) {
        this.logger.error(`AI API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
        throw new Error(
          `AI API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`,
        );
      }
      this.logger.error(`AI API request failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 处理流式响应（如果需要）
   */
  async reviewCodeStreaming(
    prompt: string,
    config: AppConfig,
    onChunk?: (chunk: string) => void,
  ): Promise<ReviewResult> {
    const url = `${config.ai.apiBaseUrl}/chat/completions`;
    const headers = {
      'Authorization': `Bearer ${config.ai.apiKey}`,
      'Content-Type': 'application/json',
    };

    const messages = [
      {
        role: 'system',
        content: '你是一位资深的代码评审专家。请仔细分析代码变更，并以 YAML 格式输出评审结果。',
      },
      {
        role: 'user',
        content: prompt,
      },
    ];

    const requestBody = {
      model: config.ai.model,
      messages,
      temperature: config.ai.temperature,
      max_tokens: config.ai.maxTokens,
      stream: true,
    };

    try {
      const response = await axios.post(url, requestBody, {
        headers,
        responseType: 'stream',
      });

      let fullContent = '';
      
      return new Promise((resolve, reject) => {
        response.data.on('data', (chunk: Buffer) => {
          const lines = chunk.toString().split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                continue;
              }
              try {
                const json = JSON.parse(data);
                const content = json.choices[0]?.delta?.content || '';
                if (content) {
                  fullContent += content;
                  onChunk?.(content);
                }
              } catch (e) {
                // 忽略解析错误
              }
            }
          }
        });

        response.data.on('end', () => {
          try {
            const reviewResult = this.parseResponse(fullContent);
            resolve(reviewResult);
          } catch (error) {
            reject(error);
          }
        });

        response.data.on('error', (error: Error) => {
          reject(error);
        });
      });
    } catch (error: any) {
      if (error.response) {
        throw new Error(
          `AI API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`,
        );
      }
      throw error;
    }
  }

  /**
   * 解析 AI 响应，提取 YAML 格式的评审结果
   */
  private parseResponse(response: string): ReviewResult {
    // 尝试提取 YAML 代码块
    const yamlMatch = response.match(/```(?:yaml|yml)?\n([\s\S]*?)\n```/);
    const yamlContent = yamlMatch ? yamlMatch[1] : response;

    try {
      const parsed = yaml.load(yamlContent) as ReviewResult;
      
      // 验证结果格式
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid YAML structure');
      }

      // 确保 issues 是数组
      if (!Array.isArray(parsed.issues)) {
        parsed.issues = [];
      }

      // 验证每个 issue 的格式
      parsed.issues = parsed.issues.filter(issue => {
        return (
          issue &&
          typeof issue === 'object' &&
          issue.type &&
          issue.file &&
          issue.line &&
          issue.title &&
          issue.description
        );
      });

      return parsed;
    } catch (error) {
      this.logger.warn(`YAML parsing failed, attempting to fix: ${error.message}`);
      
      // 尝试修复常见的 YAML 格式问题
      const fixedYaml = this.fixYamlFormat(yamlContent);
      try {
        return yaml.load(fixedYaml) as ReviewResult;
      } catch (e) {
        this.logger.error(`Failed to parse YAML after fixing: ${e.message}`);
        // 返回空结果而不是抛出错误
        return {
          issues: [],
          summary: 'Failed to parse AI response',
        };
      }
    }
  }

  /**
   * 修复常见的 YAML 格式问题
   */
  private fixYamlFormat(yamlContent: string): string {
    let fixed = yamlContent;

    // 修复缺少引号的问题
    fixed = fixed.replace(/(\w+):\s*([^:\n]+)/g, (match, key, value) => {
      const trimmedValue = value.trim();
      // 如果值包含特殊字符且没有引号，添加引号
      if (/[:\-\[\]{}|>]/.test(trimmedValue) && !trimmedValue.startsWith('"') && !trimmedValue.startsWith("'")) {
        return `${key}: "${trimmedValue}"`;
      }
      return match;
    });

    return fixed;
  }

  /**
   * 睡眠函数（用于重试延迟）
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

