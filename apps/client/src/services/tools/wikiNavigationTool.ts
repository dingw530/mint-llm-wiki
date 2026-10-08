import type { NavigateFunction } from 'react-router-dom';

export interface WikiNavigationTool {
  openPage: (filePath: string) => void;
}

/**
 * 创建打开 Wiki 页面的前端应用工具。
 *
 * @param navigate React Router 导航函数
 * @returns Wiki 页面导航工具
 */
export function createWikiNavigationTool(navigate: NavigateFunction): WikiNavigationTool {
  return {
    openPage(filePath: string) {
      const normalizedPath = filePath.trim();
      if (!normalizedPath || normalizedPath.startsWith('/') || normalizedPath.split('/').includes('..')) {
        return;
      }
      navigate('/wiki?path=' + encodeURIComponent(normalizedPath));
    },
  };
}
