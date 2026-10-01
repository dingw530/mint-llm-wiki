const bundle = await import('../server/dist/electron-bundle.js');
const port = await bundle.startServer(0);
const response = await fetch(`http://127.0.0.1:${port}/api/conversations`);
if (!response.ok) throw new Error(`Electron bundle request failed: ${response.status}`);
const conversation = bundle.conversationService.create({ title: 'Electron memory scope smoke' });
const spaceResponse = await fetch(`http://127.0.0.1:${port}/api/memory-spaces`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Electron smoke space' }),
});
if (!spaceResponse.ok)
  throw new Error(`Electron memory space request failed: ${spaceResponse.status}`);
const { space } = await spaceResponse.json();
const bindingResponse = await fetch(
  `http://127.0.0.1:${port}/api/conversations/${conversation.id}/memory-space`,
  {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spaceId: space.id }),
  },
);
if (!bindingResponse.ok)
  throw new Error(`Electron memory binding request failed: ${bindingResponse.status}`);
const binding = await bindingResponse.json();
const memory = bundle.memoryService.createMemory({
  id: 'electron-memory-scope-smoke',
  content: 'Electron process stores a scoped TypeScript memory marker',
  memoryKey: 'project.electron.smoke',
  scopeKind: 'space',
  spaceId: space.id,
});
const context = bundle.memoryService.prepareMemoryContext('Electron TypeScript marker', {
  scopeKind: 'space',
  spaceId: binding.memorySpaceId,
  bindingRevision: binding.memoryBindingRevision,
});
if (!context.observation.selectedRetrievalIds.includes(memory.id)) {
  throw new Error('Electron process did not retrieve its scoped memory fact');
}
const scopedMemories = await fetch(
  `http://127.0.0.1:${port}/api/memories?scopeKind=space&spaceId=${encodeURIComponent(space.id)}`,
);
if (!scopedMemories.ok)
  throw new Error(`Electron scoped memory list failed: ${scopedMemories.status}`);
const listedMemories = await scopedMemories.json();
if (!listedMemories.some((item) => item.id === memory.id)) {
  throw new Error('Electron HTTP endpoint did not return the scoped memory fact');
}
await bundle.shutdownServer('electron-smoke');
let rejectedAfterShutdown = false;
try {
  await fetch(`http://127.0.0.1:${port}/api/conversations`);
} catch {
  rejectedAfterShutdown = true;
}
if (!rejectedAfterShutdown)
  throw new Error('Electron HTTP listener remained available after shutdown');
console.log(
  JSON.stringify({
    port,
    started: true,
    scopedMemoryId: memory.id,
    selectedRetrievalCount: context.observation.selectedRetrievalIds.length,
    selectedMemoryPersisted: true,
    endpointStatus: scopedMemories.status,
    shutdown: true,
    rejectedRequestAfterShutdown: rejectedAfterShutdown,
  }),
);
