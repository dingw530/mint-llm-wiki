const bundle = await import('../server/dist/electron-bundle.js');
const port = await bundle.startServer(0);
const response = await fetch(`http://127.0.0.1:${port}/api/conversations`);
if (!response.ok) throw new Error(`Electron bundle request failed: ${response.status}`);
await bundle.shutdownServer('electron-smoke');
console.log(JSON.stringify({ port, started: true, shutdown: true }));
