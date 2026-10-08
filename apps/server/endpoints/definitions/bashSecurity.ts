import { getBashSecurity, updateBashSecurity } from '../../domains/tool-security/index.js';
import type { EndpointDescriptor } from '../types.js';

export const bashSecurityEndpoints: EndpointDescriptor[] = [
  {
    id: 'bash-security:get',
    method: 'GET',
    path: '/',
    preloadMethod: 'getBashSecurity',
    service: getBashSecurity,
    result: 'direct',
  },
  {
    id: 'bash-security:update',
    method: 'PUT',
    path: '/',
    preloadMethod: 'updateBashSecurity',
    service: (data: Record<string, unknown>) => {
      updateBashSecurity({
        blockedCommands: Array.isArray(data.blockedCommands) ? data.blockedCommands : [],
        blockedDirs: Array.isArray(data.blockedDirs) ? data.blockedDirs : [],
      });
      return { success: true };
    },
    args: [{ from: 'body' }],
    result: 'direct',
  },
];
