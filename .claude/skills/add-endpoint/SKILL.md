---
name: add-endpoint
description: 新增 API 接口时完成所有层的配置注册。覆盖 EndpointDescriptor 定义、前端 API 导出、Electron IPC handler 注册、preload 暴露、ElectronAPI 类型声明、manifest 同步。特别适用于 CRUD 类型的新接口。当用户说"加个接口"、"新增XX功能"、"加个按钮清空XX"、"需要个新 API"时使用此 skill。
allowed-tools: "Read, Write, Edit, Bash"
user-invocable: true
---

# add-endpoint

指导你在项目的各层中完成新增一个 API 接口所需的全部配置注册工作。

> **本 skill 仅处理配置注册层**，不包括业务逻辑实现（Repository CRUD、Service 业务方法、UI 交互）。假设这些实现已经完成。

## 工作流程

### Step 1: 确认需求

明确以下信息：

- **接口功能**：做什么的？（如"清空所有对话"）
- **HTTP 方法 + 路径**：如 `DELETE /api/conversations`
- **IPC 频道名**：如 `conversations:clearAll`
- **参数**：路径参数 / 查询参数 / Body
- **返回值**：返回什么结构
- **是否已实现业务逻辑**：Repository 和 Service 方法是否已存在

### Step 2: EndpointDescriptor 注册

在 `apps/server/endpoints/definitions/` 下找到对应的定义文件，新增一条 `EndpointDescriptor`：

```typescript
{
  id: 'xxx:action',          // IPC 频道名，必须与 preload/main 一致
  method: 'DELETE',          // GET | POST | PUT | PATCH | DELETE
  path: '/',                 // Express 路径，相对资源根
  preloadMethod: 'xxxAction', // preload.js 中的方法名
  service: () => service.action(),
  ipcServiceRef: { module: 'svcKey', method: 'action' },
  args: [],
  result: 'direct',
}
```

**关键规则：**
- `id` 必须与 `apps/electron/preload.js` 中 `ipcRenderer.invoke(...)` 的第一个参数完全一致
- 如果 `id` 与前端调用的 IPC 频道名不同，用 `ipcChannel` 字段覆盖
- `ipcServiceRef` 的 `module` 必须匹配 `apps/electron/main.js` 中 `services` 对象的 key
- 如果 endpoint 包含校验/包装逻辑且 `service` 不是直接透传，不要设置 `ipcServiceRef`（否则会绕过包装逻辑）

### Step 3: 前端 barrel 导出

在 `apps/client/src/services/api.ts` 中，把新增的函数名加入对应行的 re-export：

```typescript
export { ..., xxxAction, ... } from './api/xxx';
```

### Step 4: Electron main.js — 服务模块导入

如果新增的服务模块尚未在 `apps/electron/main.js` 的 `loadServiceModules` 中导入：

1. 在 `const importApiService = ...` 或 `const importService = ...` 后，加一行：
   ```typescript
   const newSvc = await importApiService('xxxService');
   ```
2. 将 `newSvc` 加入 `services` 对象

### Step 5: Electron main.js — IPC handler 注册

在 `apps/electron/main.js` 的 `setupIpcHandlers` 函数中，按已有模式新增 `ipcMain.handle`：

```typescript
ipcMain.handle('xxx:action', (_, ...args) => {
  if (!services.xxxSvc) throw new Error('Services not loaded');
  return services.xxxSvc.action(...args);
});
```

### Step 6: Electron preload.js

在 `apps/electron/preload.js` 的对应分类下新增一行：

```typescript
xxxAction: (...args) => ipcRenderer.invoke('xxx:action', ...args),
```

### Step 7: 前端 ElectronAPI 类型

在 `apps/client/src/types/index.ts` 的 `ElectronAPI` 接口中新增方法签名：

```typescript
xxxAction: (...args) => Promise<ReturnType>;
```

### Step 8: Manifest 同步

如果前端使用 `callEndpoint` 方式（而非直接 `request`），更新 `apps/electron/endpoints-manifest.json`：

- 新增条目的 `id`、`ipcChannel`、`httpPath`
- 或全局替换（如批量重命名频道时）

### Step 9: 一致性检查

验证以下对应关系全部正确：

| 位置 | 频道名/方法名 |
|---|---|
| `endpoints/definitions/*.ts` → `id` | `xxx:action` |
| `endpoints/definitions/*.ts` → `ipcChannel`（如有） | 同左或覆盖值 |
| `apps/electron/preload.js` → `ipcRenderer.invoke(...)` | `xxx:action` |
| `apps/electron/main.js` → `ipcMain.handle(...)` | `xxx:action` |
| `apps/client/src/types/index.ts` → `ElectronAPI` 方法名 | 与 preload 属性名一致 |
| `apps/electron/endpoints-manifest.json` → `id` | `xxx:action` |

## 示例：清空全部对话

```typescript
// ── endpoints/definitions/conversations.ts ──
{
  id: 'conversations:clearAll',
  method: 'DELETE',
  path: '/',
  preloadMethod: '',
  service: () => conversationService.removeAll(),
  ipcServiceRef: { module: 'convSvc', method: 'removeAll' },
  args: [],
  result: 'direct',
}

// ── apps/electron/main.js ──
ipcMain.handle('conversations:clearAll', () => {
  if (!services.convSvc) throw new Error('Services not loaded');
  return services.convSvc.removeAll();
});

// ── apps/electron/preload.js ──
clearAllConversations: () => ipcRenderer.invoke('conversations:clearAll'),

// ── apps/client/src/types/index.ts ──
clearAllConversations: () => Promise<{ changes: number }>;
```
