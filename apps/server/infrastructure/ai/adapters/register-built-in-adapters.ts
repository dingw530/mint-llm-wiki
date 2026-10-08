/** Load provider modules at the explicit Agent Runtime composition boundary. */
export function registerBuiltInAdapters(): Promise<void> {
  return Promise.all([
    import('./openai-chat-adapter.js'),
    import('./openai-responses-adapter.js'),
    import('./anthropic-adapter.js'),
  ]).then(() => undefined);
}
