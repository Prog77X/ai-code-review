/**
 * Token 管理服务
 */
import { Injectable } from '@nestjs/common';
import { encoding_for_model } from '@dqbd/tiktoken';
import { AppConfig } from '../types';

@Injectable()
export class TokenService {
  private encoders: Map<string, any> = new Map();

  /**
   * 获取指定模型的编码器
   */
  private getEncoder(model: string): any {
    if (!this.encoders.has(model)) {
      try {
        // 尝试获取模型特定的编码器，如果失败则使用 cl100k_base（GPT-4 默认）
        const encoder = encoding_for_model(model as any);
        this.encoders.set(model, encoder);
      } catch (error) {
        // 如果模型不支持，使用 cl100k_base
        const encoder = encoding_for_model('gpt-4');
        this.encoders.set(model, encoder);
      }
    }
    return this.encoders.get(model);
  }

  /**
   * 计算文本的 token 数量
   */
  countTokens(text: string, model: string = 'gpt-4'): number {
    const encoder = this.getEncoder(model);
    const tokens = encoder.encode(text);
    return tokens.length;
  }

  /**
   * 计算可用 token 数量
   */
  calculateAvailableTokens(
    config: AppConfig,
    inputTokens: number,
  ): number {
    const totalLimit = config.ai.maxTokens;
    const reserved = config.token.reservedOutputTokens;
    return Math.max(0, totalLimit - inputTokens - reserved);
  }

  /**
   * 检查文本是否超出 token 限制
   */
  exceedsTokenLimit(
    text: string,
    config: AppConfig,
    model: string = 'gpt-4',
  ): boolean {
    const tokens = this.countTokens(text, model);
    const available = this.calculateAvailableTokens(config, tokens);
    return available < 0;
  }

  /**
   * 估算文本长度对应的 token 数量（快速估算，不精确）
   */
  estimateTokens(text: string): number {
    // 粗略估算：英文约 4 字符 = 1 token，中文约 1.5 字符 = 1 token
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars / 1.5 + otherChars / 4);
  }
}

