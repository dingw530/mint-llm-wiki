import type { ToolRuntimeToolReference } from './contracts.js';

export interface ToolRuntimeRegistrationOptions {
  replace?: boolean;
}

/** Stores tools by stable name without depending on a host's tool or schema type. */
export class ToolRuntimeRegistry<Tool extends ToolRuntimeToolReference> {
  private readonly tools = new Map<string, Tool>();

  /** Adds a tool, rejecting accidental replacement unless the host opts in. */
  register(tool: Tool, options: ToolRuntimeRegistrationOptions = {}): void {
    if (!tool.name.trim()) throw new Error('Tool name is required');
    if (this.tools.has(tool.name) && !options.replace) {
      throw new Error(`Tool is already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  /** Registers a batch using the same duplicate-name policy as register(). */
  registerAll(tools: readonly Tool[], options: ToolRuntimeRegistrationOptions = {}): void {
    for (const tool of tools) this.register(tool, options);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  get size(): number {
    return this.tools.size;
  }
}
