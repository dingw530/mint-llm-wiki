import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ChildProcess } from 'child_process';
import { spawn, execSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import * as mcpServerRepo from '../persistence/mcp-server-repository.js';
import { decrypt } from '../security/encryption.js';
import type { ToolDefinition } from '../../types.js';
import { log } from '../observability/legacy-logger.js';
import { getErrorMessage } from '../../utils/typeGuards.js';

/**
 * Formats an error's underlying cause without exposing sensitive configuration values.
 * @param error The unknown value caught during an MCP operation.
 * @returns A readable cause string, or undefined when no cause is available.
 */
function formatErrorCause(error: unknown): string | undefined {
  const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : undefined;
  if (cause === undefined || cause === null) return undefined;
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}

// macOS GUI 应用不继承 shell PATH，需要手动解析命令路径
function resolveCommand(command: string): string {
  log.debug(`resolveCommand: input="${command}"`);

  if (command.includes('/')) {
    log.debug(`resolveCommand: already a path → "${command}"`);
    return command;
  }

  const homedirPath = homedir();
  const searchPaths = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    `${homedirPath}/.local/bin`,
    `${homedirPath}/.cargo/bin`,
  ];

  // 动态扫描 Python 用户 bin 目录（pip/pipx 安装的命令在这里）
  const pythonLibDir = `${homedirPath}/Library/Python`;
  if (existsSync(pythonLibDir)) {
    try {
      for (const ver of readdirSync(pythonLibDir)) {
        const binDir = `${pythonLibDir}/${ver}/bin`;
        if (existsSync(binDir)) searchPaths.push(binDir);
      }
    } catch {
      /* ignore */
    }
  }

  searchPaths.push('/usr/bin', '/bin');

  log.debug(`resolveCommand: searching in ${searchPaths.length} paths, home=${homedirPath}`);

  for (const dir of searchPaths) {
    const fullPath = join(dir, command);
    const exists = existsSync(fullPath);
    log.debug(`resolveCommand: check "${fullPath}" → ${exists ? 'FOUND' : 'not found'}`);
    if (exists) return fullPath;
  }

  // 回退到 which 命令
  try {
    log.debug(`resolveCommand: running "which ${command}"`);
    const resolved = execSync(`which ${command}`, { encoding: 'utf-8', timeout: 3000 }).trim();
    if (resolved) {
      log.debug(`resolveCommand: which found → "${resolved}"`);
      return resolved;
    }
  } catch (err) {
    log.warn(`resolveCommand: "which" failed: ${getErrorMessage(err)}`);
  }

  log.warn(`resolveCommand: could not resolve "${command}", will try as-is`);
  return command;
}

function getShellPath(): string {
  const home = homedir();
  const parts = ['/opt/homebrew/bin', '/usr/local/bin', `${home}/.local/bin`, `${home}/.cargo/bin`];

  // 同样加上 Python 用户 bin 目录
  const pythonLibDir = `${home}/Library/Python`;
  if (existsSync(pythonLibDir)) {
    try {
      for (const ver of readdirSync(pythonLibDir)) {
        const binDir = `${pythonLibDir}/${ver}/bin`;
        if (existsSync(binDir)) parts.push(binDir);
      }
    } catch {
      /* ignore */
    }
  }

  parts.push('/usr/bin', '/bin');
  return parts.join(':');
}

interface ConnectedServer {
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
  process?: ChildProcess;
  name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inputSchema(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function isChildProcess(value: unknown): value is ChildProcess {
  return typeof value === 'object' && value !== null && 'pid' in value && 'kill' in value;
}

export class McpClientManager {
  private connections: Map<string, ConnectedServer> = new Map();
  private toolsCache: Map<
    string,
    { name: string; description: string; inputSchema?: Record<string, unknown> }[]
  > = new Map();
  private loadedTools = new Set<string>();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    log.info('McpService initializing...');
    const servers = mcpServerRepo.findAll();
    log.info(`Found ${servers.length} MCP server config(s)`);

    for (const server of servers) {
      log.info(
        `Connecting to "${server.name}": ${server.url ? `url="${server.url}"` : `command="${server.command}"`}`,
      );
      try {
        await this.connectServer(server);
        log.info(`"${server.name}" connected successfully`);
      } catch (err) {
        const msg = getErrorMessage(err);
        log.error(`Failed to connect "${server.name}": ${msg}`);
        log.error(`Stack: ${err instanceof Error ? err.stack : undefined}`);
        mcpServerRepo.update(server.id, {
          status: 'error',
          errorMessage: msg,
        });
      }
    }
  }

  async connectServer(config: {
    id: string;
    name: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    url?: string | null;
    headers?: Record<string, string>;
  }): Promise<void> {
    log.info(`[${config.name}] Connecting...`);
    log.debug(
      `[${config.name}] Raw config: ${config.url ? `url="${config.url}"` : `command="${config.command}", args=[${config.args.join(', ')}]`}, env keys=[${Object.keys(config.env || {}).join(', ')}], header keys=[${Object.keys(config.headers || {}).join(', ')}]`,
    );

    if (config.url) {
      let url: URL;
      try {
        url = new URL(config.url);
      } catch {
        throw new Error(`Invalid MCP URL: ${config.url}`);
      }
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error(`MCP URL must use http or https: ${config.url}`);
      }

      const transport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers: config.headers || {} },
      });
      const client = new Client({ name: 'ai-chat-client', version: '1.0.0' }, { capabilities: {} });
      mcpServerRepo.update(config.id, { status: 'connecting', errorMessage: null });
      try {
        await client.connect(transport);
      } catch (err) {
        const cause = formatErrorCause(err);
        if (cause) log.error(`[${config.name}] client.connect() cause: ${cause}`);
        await transport.close().catch(() => undefined);
        throw err;
      }
      const connectedServer: ConnectedServer = { client, transport, name: config.name };
      this.connections.set(config.name, connectedServer);
      await this.cacheTools(config, connectedServer);
      mcpServerRepo.update(config.id, { status: 'connected', errorMessage: null });
      transport.onerror = (err) => log.error(`[${config.name}] transport error: ${err.message}`);
      transport.onclose = () => {
        this.connections.delete(config.name);
        this.toolsCache.delete(config.name);
      };
      return;
    }

    // 解密环境变量
    const decryptedEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(config.env || {})) {
      if (key.endsWith('_ENCRYPTED')) {
        const realKey = key.slice(0, -10);
        try {
          decryptedEnv[realKey] = decrypt(value);
          log.debug(`[${config.name}] Decrypted env var "${realKey}"`);
        } catch {
          decryptedEnv[realKey] = value;
          log.warn(`[${config.name}] Failed to decrypt "${realKey}", using raw value`);
        }
      } else {
        decryptedEnv[key] = value;
      }
    }

    // 解析命令路径
    const resolvedCommand = resolveCommand(config.command);
    log.info(`[${config.name}] Resolved command: "${resolvedCommand}"`);

    // 检查命令文件是否存在（仅对已解析的绝对路径做检查）
    if (resolvedCommand.includes('/') && !existsSync(resolvedCommand)) {
      log.error(`[${config.name}] Command file does not exist: "${resolvedCommand}"`);
      throw new Error(`Command not found: ${config.command} (resolved: ${resolvedCommand})`);
    }

    // 构建子进程环境
    const shellPath = getShellPath();
    const childEnv = {
      PATH: shellPath,
      HOME: homedir(),
      ...process.env, // 继承主进程环境（包含 AI_CHAT_ENCRYPTION_KEY 等）
      ...decryptedEnv, // 用户配置的环境变量优先
    };

    log.info(`[${config.name}] Spawning: ${resolvedCommand} ${config.args.join(' ')}`);
    log.debug(`[${config.name}] Child PATH: ${shellPath}`);
    log.debug(`[${config.name}] Working dir: ${process.cwd()}`);
    log.debug(`[${config.name}] Env keys: HOME, PATH, ${Object.keys(decryptedEnv).join(', ')}`);

    const transport = new StdioClientTransport({
      command: resolvedCommand,
      args: config.args,
      env: childEnv,
      stderr: 'pipe',
    });

    const client = new Client({ name: 'ai-chat-client', version: '1.0.0' }, { capabilities: {} });

    mcpServerRepo.update(config.id, { status: 'connecting', errorMessage: null });

    // 尝试连接
    try {
      log.debug(`[${config.name}] Calling client.connect()...`);
      await client.connect(transport);
      log.info(`[${config.name}] client.connect() succeeded`);
    } catch (err) {
      const msg = getErrorMessage(err);
      log.error(`[${config.name}] client.connect() FAILED: ${msg}`);
      const cause = formatErrorCause(err);
      if (cause) log.error(`[${config.name}] Cause: ${cause}`);
      log.error(`[${config.name}] Stack: ${err instanceof Error ? err.stack : undefined}`);

      // 检查是否是 ENOENT
      if (msg.includes('ENOENT') || msg.includes('spawn')) {
        log.error(
          `[${config.name}] SPAWN FAILURE — command="${resolvedCommand}" exists=${existsSync(resolvedCommand)}`,
        );
        // 测试直接 spawn
        try {
          const test = spawn(resolvedCommand, config.args, {
            env: childEnv,
            stdio: 'pipe',
            timeout: 5000,
          });
          test.on('error', (e) => log.error(`[${config.name}] Test spawn error: ${e.message}`));
          test.on('spawn', () => {
            log.info(`[${config.name}] Test spawn succeeded (pid=${test.pid})`);
            test.kill();
          });
        } catch (e) {
          log.error(`[${config.name}] Test spawn threw: ${getErrorMessage(e)}`);
        }
      }

      throw err;
    }

    const childProcValue = Reflect.get(transport, '_process');
    const childProc = isChildProcess(childProcValue) ? childProcValue : undefined;
    if (!childProc) {
      log.error(`[${config.name}] No child process after connect!`);
      throw new Error('MCP server process not available after connection');
    }
    const stdioProcess = childProc;

    log.info(
      `[${config.name}] Process spawned: pid=${childProc.pid}, channel=${childProc.channel}, connected=${childProc.connected}`,
    );

    const connectedServer: ConnectedServer = {
      client,
      transport,
      process: childProc,
      name: config.name,
    };
    this.connections.set(config.name, connectedServer);

    await this.cacheTools(config, connectedServer);

    mcpServerRepo.update(config.id, { status: 'connected', errorMessage: null });

    // 延迟存活检查
    setTimeout(() => {
      const alive = childProc.exitCode === null && !childProc.killed;
      log.debug(
        `[${config.name}] Alive check: pid=${childProc.pid}, exitCode=${childProc.exitCode ?? 'null'}, killed=${childProc.killed}, alive=${alive}`,
      );
      if (!alive) {
        log.warn(
          `[${config.name}] Process died shortly after connect! exitCode=${childProc.exitCode}, signalCode=${childProc.signalCode}`,
        );
      }
    }, 1000);

    // 进程退出监听
    stdioProcess.on('exit', (code, signal) => {
      log.info(`[${config.name}] Process exited: code=${code}, signal=${signal}`);
      this.connections.delete(config.name);
      const dbServer = mcpServerRepo.findByName(config.name);
      if (dbServer) {
        mcpServerRepo.update(dbServer.id, {
          status: 'inactive',
          errorMessage: `Process exited (code=${code}, signal=${signal})`,
        });
      }
    });

    // 收集 stderr
    stdioProcess.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) log.warn(`[${config.name}] stderr: ${text}`);
    });
  }

  /**
   * Discovers and caches tools exposed by a connected MCP server.
   * @param config MCP server configuration.
   * @param connectedServer Connected client and transport.
   * @returns A promise resolved after tool discovery completes.
   */
  private async cacheTools(
    config: { name: string },
    connectedServer: ConnectedServer,
  ): Promise<void> {
    try {
      const result = await connectedServer.client.listTools();
      log.info(`[${config.name}] listTools returned ${result.tools.length} tool(s)`);
      this.toolsCache.set(
        config.name,
        result.tools.map((t) => ({
          name: t.name,
          description: t.description || '',
          inputSchema: inputSchema(t.inputSchema),
        })),
      );
    } catch (err) {
      log.error(`[${config.name}] listTools failed: ${getErrorMessage(err)}`);
      this.toolsCache.set(config.name, []);
    }
  }

  async disconnectServer(serverName: string): Promise<void> {
    const conn = this.connections.get(serverName);
    if (!conn) return;

    log.info(`Disconnecting "${serverName}"...`);
    try {
      await conn.client.close();
      await conn.transport.close();
    } catch (err) {
      log.error(`Error closing "${serverName}": ${errorMessage(err)}`);
    }

    const process = conn.process;
    if (process && !process.killed) {
      process.kill('SIGTERM');
      setTimeout(() => {
        if (!process.killed) {
          process.kill('SIGKILL');
        }
      }, 3000);
    }

    this.connections.delete(serverName);
    this.toolsCache.delete(serverName);
    for (const name of this.loadedTools) {
      if (name.startsWith(`${serverName}__`)) this.loadedTools.delete(name);
    }

    const dbServer = mcpServerRepo.findByName(serverName);
    if (dbServer) {
      mcpServerRepo.update(dbServer.id, { status: 'inactive', errorMessage: null });
    }
  }

  async restartServer(serverName: string): Promise<void> {
    await this.disconnectServer(serverName);
    const dbServer = mcpServerRepo.findByName(serverName);
    if (!dbServer) throw new Error(`Server "${serverName}" not found`);
    await this.connectServer(dbServer);
  }

  async getTools(): Promise<ToolDefinition[]> {
    const tools: ToolDefinition[] = [];
    for (const [serverName] of this.connections.entries()) {
      const serverTools = this.toolsCache.get(serverName) || [];
      for (const tool of serverTools) {
        tools.push({
          type: 'function',
          function: {
            name: `${serverName}__${tool.name}`,
            description: tool.description || '',
            parameters: inputSchema(tool.inputSchema),
          },
        });
      }
    }
    return tools;
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const conn = this.connections.get(serverName);
    if (!conn) throw new Error(`MCP server "${serverName}" is not connected`);
    return await conn.client.callTool({ name: toolName, arguments: args });
  }

  /** 返回不含完整 Schema 的 MCP 工具目录，供主动发现使用。 */
  getToolCatalog(serverNames?: string[]): Array<{
    serverName: string;
    name: string;
    description: string;
  }> {
    const catalog: Array<{ serverName: string; name: string; description: string }> = [];
    for (const [serverName, serverTools] of this.toolsCache.entries()) {
      if (serverNames && !serverNames.includes(serverName)) continue;
      for (const tool of serverTools) {
        catalog.push({ serverName, name: tool.name, description: tool.description || '' });
      }
    }
    return catalog;
  }

  /** 按兼容名称查找单个 MCP 工具的完整定义。 */
  getToolDefinition(fullName: string): ToolDefinition | undefined {
    const separatorIndex = fullName.indexOf('__');
    if (separatorIndex <= 0) return undefined;
    const serverName = fullName.slice(0, separatorIndex);
    const toolName = fullName.slice(separatorIndex + 2);
    const tool = this.toolsCache.get(serverName)?.find((item) => item.name === toolName);
    if (!tool) return undefined;
    return {
      type: 'function',
      function: {
        name: fullName,
        description: tool.description || '',
        parameters: inputSchema(tool.inputSchema),
      },
    };
  }

  /** 返回 MCP 适配器所需的来源和原始 Schema。 */
  getToolRecord(fullName: string):
    | {
        serverName: string;
        name: string;
        description: string;
        inputSchema?: Record<string, unknown>;
      }
    | undefined {
    const separatorIndex = fullName.indexOf('__');
    if (separatorIndex <= 0) return undefined;
    const serverName = fullName.slice(0, separatorIndex);
    const name = fullName.slice(separatorIndex + 2);
    const tool = this.toolsCache.get(serverName)?.find((item) => item.name === name);
    return tool
      ? { serverName, name, description: tool.description || '', inputSchema: tool.inputSchema }
      : undefined;
  }

  /** 标记工具已按需加载，下一轮构建工具定义时纳入。 */
  markToolLoaded(fullName: string): void {
    if (this.getToolDefinition(fullName)) this.loadedTools.add(fullName);
  }

  getLoadedToolNames(): string[] {
    return Array.from(this.loadedTools);
  }

  /** 返回兼容模式需要注册的全部 MCP 工具名称。 */
  getAllToolNames(serverNames?: string[]): string[] {
    return this.getToolCatalog(serverNames).map((tool) => `${tool.serverName}__${tool.name}`);
  }

  getServerTools(serverName: string) {
    return this.toolsCache.get(serverName) || [];
  }

  getStatus(serverName: string) {
    return { connected: this.connections.has(serverName) };
  }

  getAllStatus(): Record<string, { connected: boolean }> {
    const status: Record<string, { connected: boolean }> = {};
    for (const [name] of this.connections.entries()) {
      status[name] = { connected: true };
    }
    return status;
  }

  async shutdown(): Promise<void> {
    const names = Array.from(this.connections.keys());
    await Promise.all(names.map((name) => this.disconnectServer(name)));
  }
}
