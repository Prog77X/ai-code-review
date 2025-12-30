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
  async extractCodeBlocks(
    diffLines: DiffLine[],
    filePath: string,
    config: AppConfig,
  ): Promise<CodeBlock[]> {
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
        return await this.extractVueCodeBlocks(diffLines, filePath, addedLines, config);
      }

      // 构建完整代码（用于 AST 解析）
      const fullCode = this.buildFullCode(diffLines);
      if (!fullCode) {
        return [];
      }

      // 解析 AST（带超时保护）
      const ast = await this.parseCodeWithTimeout(fullCode, fileExtension, config);
      if (!ast) {
        return [];
      }

      // 提取包含新增行的最小代码块
      const codeBlocks = await this.extractMinimalBlocks(
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
   * 带超时保护的 AST 解析
   */
  private async parseCodeWithTimeout(
    code: string,
    extension: string,
    config: AppConfig,
  ): Promise<any> {
    return this.withTimeout(
      () => this.parseCode(code, extension),
      config.ast.timeoutMs,
      `AST解析超时 (>${config.ast.timeoutMs}ms)`,
    );
  }

  /**
   * 超时保护包装器
   */
  private async withTimeout<T>(
    fn: () => T,
    timeoutMs: number,
    errorMessage: string,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(errorMessage));
      }, timeoutMs);

      try {
        const result = fn();
        clearTimeout(timer);
        resolve(result);
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
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
  private async extractMinimalBlocks(
    ast: any,
    addedLines: DiffLine[],
    fullCode: string,
    config: AppConfig,
  ): Promise<CodeBlock[]> {
    const addedLineNumbers = new Set(
      addedLines.map(line => line.newLineNumber).filter(Boolean) as number[],
    );

    // 收集所有包含新增行的代码块
    const allSections = this.collectImpactedSections(
      ast,
      fullCode,
      addedLineNumbers,
      config,
    );

    // 选择最小的包含块（核心优化：避免返回外层大函数）
    const selectedSections = this.selectSmallestSections(allSections, addedLineNumbers);

    // 应用大小限制和截断
    const codeBlocks: CodeBlock[] = selectedSections
      .map(section => this.limitSectionSize(section, fullCode, config))
      .filter((block): block is CodeBlock => block !== null);

    return codeBlocks;
  }

  /**
   * 收集所有包含新增行的代码块
   */
  private collectImpactedSections(
    ast: any,
    fullCode: string,
    addedLineNumbers: Set<number>,
    config: AppConfig,
  ): Array<{
    start: number;
    end: number;
    type: 'function' | 'class' | 'method';
    name?: string;
    addedLines: number[];
  }> {
    const sections: Array<{
      start: number;
      end: number;
      type: 'function' | 'class' | 'method';
      name?: string;
      addedLines: number[];
    }> = [];

    const depthLimiter = this.createDepthLimiter(config.ast.maxDepth);

    // 辅助函数：检查范围是否包含新增行
    const containsAddedLines = (start: number, end: number): number[] => {
      const relevantLines: number[] = [];
      for (const lineNum of addedLineNumbers) {
        if (lineNum >= start && lineNum <= end) {
          relevantLines.push(lineNum);
        }
      }
      return relevantLines;
    };

    // 检查是否是目标节点（函数、类、方法）
    const isTargetNode = (path: any): boolean => {
      const nodeType = path.node.type;
      return [
        'FunctionDeclaration',
        'FunctionExpression',
        'ArrowFunctionExpression',
        'ClassDeclaration',
        'ClassMethod',
        'ClassProperty',
      ].includes(nodeType);
    };

    const self = this; // 保存 this 引用
    try {
      // 遍历 AST，找到包含新增行的最小块
      traverse(ast, {
        enter(astPath: any) {
          depthLimiter.enter();

          const node = astPath.node;

          // 只关注函数和类声明（避免提取容器节点）
          if (!isTargetNode(astPath)) {
            return;
          }

          // 检查节点是否有位置信息
          if (!node.loc || !node.loc.start || !node.loc.end) {
            return;
          }

          const { start, end } = node.loc;
          const startLine = start.line;
          const endLine = end.line;

          // 检查是否包含新增行
          const relevantLines = containsAddedLines(startLine, endLine);
          if (relevantLines.length === 0) {
            return;
          }

          // 获取节点名称和类型
          const name = self.getNodeName(node, astPath);
          const type = self.getNodeType(node.type);

          sections.push({
            start: startLine,
            end: endLine,
            type,
            name,
            addedLines: relevantLines,
          });
        },
        exit() {
          depthLimiter.exit();
        },
      });
    } catch (error: any) {
      // 如果是深度限制错误，记录警告但继续
      if (error.message && error.message.includes('深度超限')) {
        this.logger.warn(`⚠️  ${error.message}, 已收集 ${sections.length} 个代码块`);
      } else {
        throw error;
      }
    }

    return sections;
  }

  /**
   * 创建递归深度限制器
   */
  private createDepthLimiter(maxDepth: number) {
    let currentDepth = 0;

    return {
      enter() {
        currentDepth++;
        if (currentDepth > maxDepth) {
          throw new Error(`AST 遍历深度超限 (${currentDepth} > ${maxDepth})`);
        }
      },
      exit() {
        currentDepth--;
      },
    };
  }

  /**
   * 获取节点名称
   */
  private getNodeName(node: any, astPath: any): string | undefined {
    // 直接命名
    if (node.id && node.id.name) {
      return node.id.name;
    }

    // 变量声明的函数
    if (astPath.parentPath && astPath.parentPath.isVariableDeclarator()) {
      const declarator = astPath.parentPath.node;
      if (declarator.id && declarator.id.name) {
        return declarator.id.name;
      }
    }

    // 对象方法/属性
    if (node.key) {
      return node.key.name || node.key.value || 'anonymous';
    }

    return 'anonymous';
  }

  /**
   * 获取节点类型
   */
  private getNodeType(nodeType: string): 'function' | 'class' | 'method' {
    if (nodeType === 'ClassDeclaration') {
      return 'class';
    }
    if (nodeType === 'ClassMethod' || nodeType === 'ClassProperty') {
      return 'method';
    }
    return 'function';
  }

  /**
   * 选择最小的包含块（核心优化：避免返回外层大函数）
   * 
   * 策略：
   * 1. 如果多个块包含相同的新增行，选择最小的块
   * 2. 如果块之间有包含关系，只保留最内层的块
   */
  private selectSmallestSections(
    sections: Array<{
      start: number;
      end: number;
      type: 'function' | 'class' | 'method';
      name?: string;
      addedLines: number[];
    }>,
    addedLineNumbers: Set<number>,
  ): Array<{
    start: number;
    end: number;
    type: 'function' | 'class' | 'method';
    name?: string;
    addedLines: number[];
  }> {
    if (sections.length === 0) {
      return [];
    }

    // 按大小排序（从小到大）
    const sortedSections = [...sections].sort((a, b) => {
      const sizeA = a.end - a.start;
      const sizeB = b.end - b.start;
      return sizeA - sizeB;
    });

    const selected: Array<{
      start: number;
      end: number;
      type: 'function' | 'class' | 'method';
      name?: string;
      addedLines: number[];
    }> = [];
    const coveredLines = new Set<number>();

    // 选择最小的块，优先覆盖未覆盖的新增行
    for (const section of sortedSections) {
      // 检查这个块是否覆盖了新的行
      const hasNewLines = section.addedLines.some(line => !coveredLines.has(line));

      if (hasNewLines) {
        // 检查是否被已选择的更小的块完全包含
        const isContained = selected.some(
          selectedSection =>
            selectedSection.start <= section.start &&
            selectedSection.end >= section.end &&
            selectedSection !== section,
        );

        if (!isContained) {
          selected.push(section);
          section.addedLines.forEach(line => coveredLines.add(line));
        }
      }
    }

    return selected;
  }

  /**
   * 限制代码块大小，超过限制则截断
   */
  private limitSectionSize(
    section: {
      start: number;
      end: number;
      type: 'function' | 'class' | 'method';
      name?: string;
      addedLines: number[];
    },
    fullCode: string,
    config: AppConfig,
  ): CodeBlock | null {
    const codeLines = fullCode.split('\n');
    const snippet = codeLines.slice(section.start - 1, section.end).join('\n');
    const size = section.end - section.start + 1;

    // 情况1: 字符数超限 - 截断到最大字符数
    if (snippet.length > config.ast.maxChars) {
      const truncated = snippet.substring(0, config.ast.maxChars);
      return {
        code: truncated + `\n\n/* ... 代码过长已截断 (总长${snippet.length}字符) */`,
        startLine: section.start,
        endLine: section.end,
        type: section.type,
        name: section.name,
      };
    }

    // 情况2: 行数超限 - 只显示新增行周围的上下文
    if (size > config.ast.maxLines) {
      const CONTEXT_RADIUS = 8; // 固定上下文行数
      const contextSnippet = this.extractContextAroundLines(
        codeLines,
        section.addedLines,
        section.start,
        section.end,
        CONTEXT_RADIUS,
      );

      return {
        code: contextSnippet + `\n\n/* ... 函数较大(${size}行)，只显示新增行周围${CONTEXT_RADIUS}行上下文 */`,
        startLine: section.start,
        endLine: section.end,
        type: section.type,
        name: section.name,
      };
    }

    // 情况3: 正常大小
    return {
      code: snippet,
      startLine: section.start,
      endLine: section.end,
      type: section.type,
      name: section.name,
    };
  }

  /**
   * 提取新增行周围的上下文代码
   */
  private extractContextAroundLines(
    codeLines: string[],
    addedLines: number[],
    startLine: number,
    endLine: number,
    contextRadius: number,
  ): string {
    if (addedLines.length === 0) {
      return codeLines.slice(startLine - 1, endLine).join('\n');
    }

    const minAddedLine = Math.min(...addedLines);
    const maxAddedLine = Math.max(...addedLines);

    const contextStart = Math.max(startLine, minAddedLine - contextRadius);
    const contextEnd = Math.min(endLine, maxAddedLine + contextRadius);

    const context = codeLines.slice(contextStart - 1, contextEnd);
    
    // 如果上下文不是从函数开始，添加省略标记
    if (contextStart > startLine) {
      context.unshift('/* ... 前面的代码 ... */');
    }
    
    // 如果上下文不是到函数结束，添加省略标记
    if (contextEnd < endLine) {
      context.push('/* ... 后面的代码 ... */');
    }

    return context.join('\n');
  }


  /**
   * 提取 Vue 文件的代码块（仅分析 Script 部分）
   */
  private async extractVueCodeBlocks(
    diffLines: DiffLine[],
    filePath: string,
    addedLines: DiffLine[],
    config: AppConfig,
  ): Promise<CodeBlock[]> {
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

