/**
 * 文件工具函数
 */

/**
 * 检查文件扩展名是否支持
 */
export function isSupportedFile(filePath: string, supportedExtensions: string[]): boolean {
  const extension = filePath.split('.').pop()?.toLowerCase();
  return extension ? supportedExtensions.includes(extension) : false;
}

/**
 * 从文件路径提取扩展名
 */
export function getFileExtension(filePath: string): string {
  const parts = filePath.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

/**
 * 判断是否为代码文件
 */
export function isCodeFile(filePath: string, supportedExtensions: string[]): boolean {
  return isSupportedFile(filePath, supportedExtensions);
}

