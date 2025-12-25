/**
 * AST 智能分析服务
 */
import { Injectable, Logger } from '@nestjs/common';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import { CodeBlock, DiffLine } from '../types';
import { AppConfig } from '../types';

// Vue SFC 编译器（延迟加载）
let vueSfcCompiler: any = null;

/**
 * 延迟加载 Vue SFC 编译器
 */
function loadVueSfcCompiler(): any {
  if (vueSfcCompiler) return vueSfcCompiler;
  
  try {
    const { parse: parseSFC } = require('@vue/compiler-sfc');
    vueSfcCompiler = { parseSFC };
    return vueSfcCompiler;
  } catch (error) {
    return null;
  }
}

@Injectable()
export class AstService {
  private readonly logger = new Logger(AstService.name);

  /**
   * 从 diff 中提取代码块（最小包含块原则）
   */
  extractCodeBlocks(
    diffLines: DiffLine[],
    filePath: string,
    config: AppConfig,
  ): CodeBlock[] {
    const addedLines = diffLines.filter(line => line.type === 'added');
    if (addedLines.length === 0) {
      return [];
    }

    const fileExtension = this.getFileExtension(filePath);
    if (!this.isSupportedLanguage(fileExtension)) {
      return [];
    }

    try {
      // Vue 文件特殊处理
      if (fileExtension === 'vue') {
        return this.extractVueCodeBlocks(diffLines, filePath, addedLines, config);
      }

      // 构建完整代码（用于 AST 解析）
      const fullCode = this.buildFullCode(diffLines);
      if (!fullCode) {
        return [];
      }

      // 解析 AST
      const ast = this.parseCode(fullCode, fileExtension);
      if (!ast) {
        return [];
      }

      // 提取包含新增行的最小代码块
      const codeBlocks = this.extractMinimalBlocks(
        ast,
        addedLines,
        fullCode,
        config,
      );

      return codeBlocks;
    } catch (error: any) {
      // AST 解析失败时，优雅降级为简单代码块提取
      // 这通常发生在文件格式不支持或代码片段不完整时
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug(`AST parsing failed for ${filePath}, using fallback: ${error.message}`);
      }
      return this.fallbackExtractBlocks(addedLines, config);
    }
  }

  /**
   * 获取文件扩展名
   */
  private getFileExtension(filePath: string): string {
    const parts = filePath.split('.');
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
  }

  /**
   * 检查是否支持的语言
   */
  private isSupportedLanguage(extension: string): boolean {
    return ['js', 'jsx', 'ts', 'tsx', 'vue'].includes(extension);
  }

  /**
   * 构建完整代码（包含上下文）
   */
  private buildFullCode(diffLines: DiffLine[]): string | null {
    const lines: string[] = [];
    for (const diffLine of diffLines) {
      let content = diffLine.content;
      
      // 跳过 diff header 行
      if (content.startsWith('@@') || content.startsWith('---') || content.startsWith('+++')) {
        continue;
      }
      
      // 移除 diff 标记（+, -, 空格）
      content = content.replace(/^[+\- ]/, '');
      
      // 跳过空行（在过滤 header 之后）
      if (!content.trim()) {
        continue;
      }
      
      lines.push(content);
    }
    
    const code = lines.join('\n').trim();
    return code || null;
  }

  /**
   * 解析代码为 AST
   */
  private parseCode(code: string, extension: string): any {
    // 基础插件列表
    const plugins: string[] = [
      'typescript',
      'decorators-legacy',
      'classProperties',
      'objectRestSpread',
      'optionalChaining',
      'nullishCoalescingOperator',
      'topLevelAwait',
      'dynamicImport',
    ];

    // 根据文件类型添加特定插件
    if (extension === 'tsx' || extension === 'jsx') {
      plugins.push('jsx');
    }

    try {
      // 检查代码是否为空或只包含空白字符
      if (!code || !code.trim()) {
        return null;
      }

      // 尝试解析代码
      return parser.parse(code, {
        sourceType: 'module',
        plugins: plugins as any,
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        errorRecovery: true, // 启用错误恢复
        tokens: false, // 不生成 tokens，提高性能
      });
    } catch (error: any) {
      // 对于解析错误，尝试使用更宽松的配置
      try {
        // 如果第一次解析失败，尝试使用更基础的插件配置
        const fallbackPlugins = extension === 'tsx' || extension === 'jsx' 
          ? ['typescript', 'jsx']
          : ['typescript'];
        
        return parser.parse(code, {
          sourceType: 'unambiguous', // 尝试自动检测模块类型
          plugins: fallbackPlugins as any,
          allowReturnOutsideFunction: true,
          allowAwaitOutsideFunction: true,
          errorRecovery: true,
          tokens: false,
        });
      } catch (fallbackError: any) {
        // 如果降级解析也失败，记录错误并返回 null
        // 只在调试模式下记录详细信息
        if (process.env.NODE_ENV === 'development') {
          this.logger.debug(
            `AST parse error for ${extension} file: ${error.message}` +
            (fallbackError.message !== error.message ? ` (fallback also failed: ${fallbackError.message})` : ''),
          );
        }
        return null;
      }
    }
  }

  /**
   * 提取最小包含块
   */
  private extractMinimalBlocks(
    ast: any,
    addedLines: DiffLine[],
    fullCode: string,
    config: AppConfig,
  ): CodeBlock[] {
    const codeBlocks: CodeBlock[] = [];
    const addedLineNumbers = new Set(
      addedLines.map(line => line.newLineNumber).filter(Boolean) as number[],
    );

    // 存储每个函数/类的行号范围
    const blockRanges: Array<{
      start: number;
      end: number;
      type: 'function' | 'class' | 'method';
      name?: string;
    }> = [];

    // 辅助函数：检查范围是否包含新增行
    const containsAddedLines = (start: number, end: number): boolean => {
      for (const lineNum of addedLineNumbers) {
        if (lineNum >= start && lineNum <= end) {
          return true;
        }
      }
      return false;
    };

    // 遍历 AST，找到包含新增行的最小块
    traverse(ast, {
      FunctionDeclaration(path: any) {
        const { start, end } = path.node.loc || {};
        if (start && end) {
          const startLine = start.line;
          const endLine = end.line;
          if (containsAddedLines(startLine, endLine)) {
            blockRanges.push({
              start: startLine,
              end: endLine,
              type: 'function',
              name: path.node.id?.name,
            });
          }
        }
      },
      FunctionExpression(path: any) {
        const { start, end } = path.node.loc || {};
        if (start && end) {
          const startLine = start.line;
          const endLine = end.line;
          if (containsAddedLines(startLine, endLine)) {
            blockRanges.push({
              start: startLine,
              end: endLine,
              type: 'function',
              name: path.node.id?.name || 'anonymous',
            });
          }
        }
      },
      ArrowFunctionExpression(path: any) {
        const { start, end } = path.node.loc || {};
        if (start && end) {
          const startLine = start.line;
          const endLine = end.line;
          if (containsAddedLines(startLine, endLine)) {
            blockRanges.push({
              start: startLine,
              end: endLine,
              type: 'function',
              name: 'arrow',
            });
          }
        }
      },
      ClassDeclaration(path: any) {
        const { start, end } = path.node.loc || {};
        if (start && end) {
          const startLine = start.line;
          const endLine = end.line;
          if (containsAddedLines(startLine, endLine)) {
            blockRanges.push({
              start: startLine,
              end: endLine,
              type: 'class',
              name: path.node.id?.name,
            });
          }
        }
      },
      ClassMethod(path: any) {
        const { start, end } = path.node.loc || {};
        if (start && end) {
          const startLine = start.line;
          const endLine = end.line;
          if (containsAddedLines(startLine, endLine)) {
            blockRanges.push({
              start: startLine,
              end: endLine,
              type: 'method',
              name: path.node.key?.name || 'anonymous',
            });
          }
        }
      },
    });

    // 提取代码块内容
    const codeLines = fullCode.split('\n');
    for (const range of blockRanges) {
      const code = codeLines.slice(range.start - 1, range.end).join('\n');
      
      // 检查限制
      if (code.length > config.ast.maxChars) {
        continue;
      }
      if (range.end - range.start + 1 > config.ast.maxLines) {
        continue;
      }

      codeBlocks.push({
        code,
        startLine: range.start,
        endLine: range.end,
        type: range.type,
        name: range.name,
      });
    }

    return codeBlocks;
  }

  /**
   * 检查范围是否包含新增行
   */
  private containsAddedLines(
    start: number,
    end: number,
    addedLineNumbers: Set<number>,
  ): boolean {
    for (const lineNum of addedLineNumbers) {
      if (lineNum >= start && lineNum <= end) {
        return true;
      }
    }
    return false;
  }

  /**
   * 提取 Vue 文件的代码块（仅分析 Script 部分）
   */
  private extractVueCodeBlocks(
    diffLines: DiffLine[],
    filePath: string,
    addedLines: DiffLine[],
    config: AppConfig,
  ): CodeBlock[] {
    const compiler = loadVueSfcCompiler();
    if (!compiler) {
      this.logger.debug('@vue/compiler-sfc not available, using fallback for Vue file');
      return this.fallbackExtractBlocks(addedLines, config);
    }

    try {
      // 构建完整代码（从 diff 重建）
      const fullCode = this.buildFullCode(diffLines);
      if (!fullCode) {
        return this.fallbackExtractBlocks(addedLines, config);
      }

      // 解析 Vue SFC
      const { descriptor, errors } = compiler.parseSFC(fullCode, { filename: filePath });
      
      if (errors && errors.length > 0) {
        this.logger.debug(`Vue SFC parse errors: ${errors.length}`);
      }

      const codeBlocks: CodeBlock[] = [];
      const addedLineNumbers = new Set(
        addedLines.map(line => line.newLineNumber).filter(Boolean) as number[],
      );

      // 处理 script 部分
      if (descriptor.script && descriptor.script.content) {
        const scriptStartLine = descriptor.script.loc?.start?.line || 1;
        const scriptBlocks = this.extractScriptBlocks(
          descriptor.script.content,
          addedLineNumbers,
          scriptStartLine,
          config,
        );
        codeBlocks.push(...scriptBlocks);
      }

      // 处理 script setup 部分
      if (descriptor.scriptSetup && descriptor.scriptSetup.content) {
        const scriptStartLine = descriptor.scriptSetup.loc?.start?.line || 1;
        const scriptBlocks = this.extractScriptBlocks(
          descriptor.scriptSetup.content,
          addedLineNumbers,
          scriptStartLine,
          config,
        );
        codeBlocks.push(...scriptBlocks);
      }

      return codeBlocks.length > 0 ? codeBlocks : this.fallbackExtractBlocks(addedLines, config);
    } catch (error: any) {
      this.logger.debug(`Vue file parsing failed: ${error.message}`);
      return this.fallbackExtractBlocks(addedLines, config);
    }
  }

  /**
   * 提取 Script 部分的代码块
   */
  private extractScriptBlocks(
    scriptContent: string,
    addedLineNumbers: Set<number>,
    scriptStartLine: number,
    config: AppConfig,
  ): CodeBlock[] {
    // 将文件行号转换为 script 内部行号
    const scriptAddedLines = new Set<number>();
    for (const lineNum of addedLineNumbers) {
      if (lineNum >= scriptStartLine) {
        scriptAddedLines.add(lineNum - scriptStartLine + 1);
      }
    }

    if (scriptAddedLines.size === 0) {
      return [];
    }

    try {
      // 解析 script AST
      const ast = parser.parse(scriptContent, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx', 'decorators-legacy', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'],
        errorRecovery: true,
      });

      const codeBlocks: CodeBlock[] = [];
      const blockRanges: Array<{
        start: number;
        end: number;
        type: 'function' | 'class' | 'method';
        name?: string;
      }> = [];

      // 检查范围是否包含新增行（script 内部行号）
      const containsAddedLines = (start: number, end: number): boolean => {
        for (const lineNum of scriptAddedLines) {
          if (lineNum >= start && lineNum <= end) {
            return true;
          }
        }
        return false;
      };

      // 遍历 AST
      traverse(ast, {
        FunctionDeclaration(path: any) {
          const { start, end } = path.node.loc || {};
          if (start && end && containsAddedLines(start.line, end.line)) {
            blockRanges.push({
              start: start.line + scriptStartLine - 1, // 映射回文件行号
              end: end.line + scriptStartLine - 1,
              type: 'function',
              name: path.node.id?.name,
            });
          }
        },
        FunctionExpression(path: any) {
          const { start, end } = path.node.loc || {};
          if (start && end && containsAddedLines(start.line, end.line)) {
            blockRanges.push({
              start: start.line + scriptStartLine - 1,
              end: end.line + scriptStartLine - 1,
              type: 'function',
              name: path.node.id?.name || 'anonymous',
            });
          }
        },
        ArrowFunctionExpression(path: any) {
          const { start, end } = path.node.loc || {};
          if (start && end && containsAddedLines(start.line, end.line)) {
            blockRanges.push({
              start: start.line + scriptStartLine - 1,
              end: end.line + scriptStartLine - 1,
              type: 'function',
              name: 'arrow',
            });
          }
        },
        ClassDeclaration(path: any) {
          const { start, end } = path.node.loc || {};
          if (start && end && containsAddedLines(start.line, end.line)) {
            blockRanges.push({
              start: start.line + scriptStartLine - 1,
              end: end.line + scriptStartLine - 1,
              type: 'class',
              name: path.node.id?.name,
            });
          }
        },
        ClassMethod(path: any) {
          const { start, end } = path.node.loc || {};
          if (start && end && containsAddedLines(start.line, end.line)) {
            blockRanges.push({
              start: start.line + scriptStartLine - 1,
              end: end.line + scriptStartLine - 1,
              type: 'method',
              name: path.node.key?.name || 'anonymous',
            });
          }
        },
      });

      // 提取代码块内容
      const codeLines = scriptContent.split('\n');
      for (const range of blockRanges) {
        const scriptStart = range.start - scriptStartLine + 1;
        const scriptEnd = range.end - scriptStartLine + 1;
        const code = codeLines.slice(scriptStart - 1, scriptEnd).join('\n');
        
        // 检查限制
        if (code.length > config.ast.maxChars) {
          continue;
        }
        if (range.end - range.start + 1 > config.ast.maxLines) {
          continue;
        }

        codeBlocks.push({
          code,
          startLine: range.start,
          endLine: range.end,
          type: range.type,
          name: range.name,
        });
      }

      return codeBlocks;
    } catch (error: any) {
      this.logger.debug(`Script AST parsing failed: ${error.message}`);
      return [];
    }
  }

  /**
   * 降级方案：提取简单的代码块
   */
  private fallbackExtractBlocks(
    addedLines: DiffLine[],
    config: AppConfig,
  ): CodeBlock[] {
    if (addedLines.length === 0) {
      return [];
    }

    const firstLine = addedLines[0].newLineNumber || 1;
    const lastLine = addedLines[addedLines.length - 1].newLineNumber || 1;
    const code = addedLines.map(line => line.content.replace(/^\+/, '')).join('\n');

    if (code.length > config.ast.maxChars) {
      return [];
    }
    if (lastLine - firstLine + 1 > config.ast.maxLines) {
      return [];
    }

    return [
      {
        code,
        startLine: firstLine,
        endLine: lastLine,
        type: 'unknown',
      },
    ];
  }
}

