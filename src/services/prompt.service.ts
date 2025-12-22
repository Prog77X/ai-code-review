/**
 * 提示词管理服务
 */
import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

@Injectable()
export class PromptService {
  private readonly logger = new Logger(PromptService.name);
  private systemPromptCache: string | null = null;

  /**
   * 加载系统提示词模板
   */
  loadSystemPrompt(): string {
    if (this.systemPromptCache) {
      return this.systemPromptCache;
    }

    try {
      const promptPath = join(process.cwd(), 'prompts', 'system-prompt.txt');
      const prompt = readFileSync(promptPath, 'utf-8');
      this.systemPromptCache = prompt;
      return prompt;
    } catch (error) {
      this.logger.warn('Failed to load system prompt file, using default prompt');
      return this.getDefaultSystemPrompt();
    }
  }

  /**
   * 获取默认系统提示词
   */
  private getDefaultSystemPrompt(): string {
    return `你是一位资深的代码评审专家，擅长发现代码中的潜在问题。

## 你的职责
- 仔细分析代码变更（Diff），识别潜在问题
- 关注代码质量、安全性、性能和可维护性
- 提供清晰、可操作的建议

## Diff 格式说明
- 以 \`+\` 开头的行表示新增的代码
- 以 \`-\` 开头的行表示删除的代码
- 以空格开头的行是上下文行（未变更）
- 行号信息格式：\`@@ -oldStart,oldCount +newStart,newCount @@\`

## 评审关注点
1. **逻辑错误**：潜在的 bug、边界条件处理不当
2. **安全风险**：SQL 注入、XSS、敏感信息泄露等
3. **性能问题**：不必要的循环、内存泄漏、低效算法
4. **代码质量**：可读性、可维护性、代码重复
5. **最佳实践**：命名规范、错误处理、资源管理

## 输出格式要求
请以 YAML 格式输出评审结果，格式如下：

\`\`\`yaml
issues:
  - type: critical|warning|info
    file: "文件路径"
    line: 行号
    title: "问题标题"
    description: "详细描述"
    code: "相关代码片段（可选）"
    suggestion: "改进建议（可选）"
summary: "总体评价（可选）"
\`\`\`

## 注意事项
- 只报告真正的问题，避免过度评审
- 问题描述要具体，指出问题所在
- 提供可行的改进建议
- 按严重性分类：critical（严重）、warning（警告）、info（提示）`;
  }

  /**
   * 构建完整的提示词消息
   */
  buildPrompt(diffContent: string, additionalContext?: string): string {
    const systemPrompt = this.loadSystemPrompt();
    const context = additionalContext ? `\n\n## 额外上下文\n${additionalContext}` : '';
    
    return `${systemPrompt}${context}

## 代码变更

\`\`\`diff
${diffContent}
\`\`\`

请仔细分析以上代码变更，并按照要求的格式输出评审结果。`;
  }

  /**
   * 清除提示词缓存（用于重新加载）
   */
  clearCache(): void {
    this.systemPromptCache = null;
  }
}

