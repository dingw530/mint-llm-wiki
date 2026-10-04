/** Load provider modules at the explicit Agent Runtime composition boundary. */
export function registerBuiltInAdapters(): Promise<void> {
  return Promise.all([
    import('./openaiChatAdapter.js'),
    import('./openaiResponsesAdapter.js'),
    import('./anthropicAdapter.js'),
  ]).then(() => undefined);
}
