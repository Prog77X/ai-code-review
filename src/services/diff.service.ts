/**
 * Diff 处理服务
 */
import { Injectable, Logger } from '@nestjs/common';
import { DiffLine, ExtendedDiff } from '../types';

@Injectable()
export class DiffService {
  private readonly logger = new Logger(DiffService.name);

  /**
   * 解析统一差异格式（Unified Diff Format）
   */
  parseDiff(diff: string, filePath: string, oldPath?: string): ExtendedDiff {
    const lines = diff.split('\n');
    const diffLines: DiffLine[] = [];
    let currentOldLine = 0;
    let currentNewLine = 0;
    let hunkOldStart = 0;
    let hunkOldCount = 0;
    let hunkNewStart = 0;
    let hunkNewCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 解析 hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      if (line.startsWith('@@')) {
        const hunkMatch = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (hunkMatch) {
          hunkOldStart = parseInt(hunkMatch[1], 10);
          hunkOldCount = parseInt(hunkMatch[2] || '0', 10);
          hunkNewStart = parseInt(hunkMatch[3], 10);
          hunkNewCount = parseInt(hunkMatch[4] || '0', 10);
          currentOldLine = hunkOldStart;
          currentNewLine = hunkNewStart;
          
          // 添加 hunk header 作为上下文
          diffLines.push({
            lineNumber: currentNewLine,
            content: line,
            type: 'context',
            oldLineNumber: currentOldLine,
            newLineNumber: currentNewLine,
          });
          continue;
        }
      }

      // 处理不同类型的行
      if (line.startsWith('+') && !line.startsWith('+++')) {
        // 新增行
        diffLines.push({
          lineNumber: currentNewLine,
          content: line,
          type: 'added',
          newLineNumber: currentNewLine,
        });
        currentNewLine++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        // 删除行
        diffLines.push({
          lineNumber: currentOldLine,
          content: line,
          type: 'removed',
          oldLineNumber: currentOldLine,
        });
        currentOldLine++;
      } else if (line.startsWith(' ') || line === '') {
        // 上下文行
        diffLines.push({
          lineNumber: currentNewLine,
          content: line,
          type: 'context',
          oldLineNumber: currentOldLine,
          newLineNumber: currentNewLine,
        });
        currentOldLine++;
        currentNewLine++;
      } else {
        // 其他行（如文件头）
        diffLines.push({
          lineNumber: currentNewLine || 1,
          content: line,
          type: 'context',
        });
      }
    }

    return {
      filePath,
      oldPath,
      diffLines,
    };
  }

  /**
   * 提取新增的代码行
   */
  extractAddedLines(diffLines: DiffLine[]): DiffLine[] {
    return diffLines.filter(line => line.type === 'added');
  }

  /**
   * 构建带行号的 diff 内容（用于显示）
   */
  buildNumberedDiff(extendedDiff: ExtendedDiff): string {
    const lines: string[] = [];
    
    for (const diffLine of extendedDiff.diffLines) {
      const linePrefix = this.getLinePrefix(diffLine);
      const lineInfo = this.getLineInfo(diffLine);
      lines.push(`${linePrefix}${lineInfo}${diffLine.content}`);
    }

    return lines.join('\n');
  }

  /**
   * 获取行前缀
   */
  private getLinePrefix(diffLine: DiffLine): string {
    switch (diffLine.type) {
      case 'added':
        return '+';
      case 'removed':
        return '-';
      default:
        return ' ';
    }
  }

  /**
   * 获取行号信息
   */
  private getLineInfo(diffLine: DiffLine): string {
    if (diffLine.type === 'added' && diffLine.newLineNumber) {
      return `[${diffLine.newLineNumber}] `;
    }
    if (diffLine.type === 'removed' && diffLine.oldLineNumber) {
      return `[${diffLine.oldLineNumber}] `;
    }
    if (diffLine.type === 'context') {
      if (diffLine.newLineNumber && diffLine.oldLineNumber) {
        return `[${diffLine.oldLineNumber}->${diffLine.newLineNumber}] `;
      }
      if (diffLine.newLineNumber) {
        return `[${diffLine.newLineNumber}] `;
      }
    }
    return '';
  }

  /**
   * 获取指定行号范围的代码片段
   */
  getCodeSnippet(
    extendedDiff: ExtendedDiff,
    startLine: number,
    endLine: number,
    contextLines: number = 3,
  ): string {
    const lines: string[] = [];
    const actualStart = Math.max(1, startLine - contextLines);
    const actualEnd = endLine + contextLines;

    for (const diffLine of extendedDiff.diffLines) {
      if (
        diffLine.newLineNumber &&
        diffLine.newLineNumber >= actualStart &&
        diffLine.newLineNumber <= actualEnd
      ) {
        lines.push(diffLine.content);
      }
    }

    return lines.join('\n');
  }
}

