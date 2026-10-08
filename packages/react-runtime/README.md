# @mint/react-runtime

A small ReAct execution loop for Node.js. The package has no model SDK, web framework, database, or Mint server runtime dependency. The host supplies a model port, tool definitions, and a tool executor.

## Build

```sh
npm install
npm run build -w @mint/react-runtime
```

To use the built package from another local Node.js project, create its tarball with `npm pack -w @mint/react-runtime` and install that tarball with `npm install ./mint-react-runtime-0.1.0.tgz`.

Node.js 20 or newer is required.

## Use

```ts
import { createReactAgent } from '@mint/react-runtime';

const agent = createReactAgent({
  model: {
    async generate({ messages, tools, step, signal }) {
      // Call your model SDK here. Return tool calls as { id, name, input }.
      return {
        assistantMessage: { role: 'assistant', content: 'done' },
        toolCalls: [],
      };
    },
  },
  toolExecutor: {
    async execute({ call, signal }) {
      // Validate authorization and input before performing side effects.
      const result = await runMyTool(call.name, call.input, signal);
      return {
        status: 'success',
        messages: [{ role: 'tool', toolCallId: call.id, content: JSON.stringify(result) }],
      };
    },
  },
  policy: { maxSteps: 8 },
});

const result = await agent.run({
  messages: [{ role: 'user', content: 'What is the weather?' }],
  tools: [{ name: 'weather', inputSchema: { type: 'object' } }],
  signal: AbortSignal.timeout(30_000),
  onEvent: (event) => console.log(event.type),
});
```

The model and tool message types are generic. The framework preserves the supplied messages, executes calls concurrently while retaining model call order in the transcript, and stops on a final model response, pause, cancellation, failure policy, or step limit. Tool errors stop the run by default; set `continueOnToolError: true` when the executor returns a safe tool-error message for the model. The host owns tool schema validation, permissions, retries, persistence, and transport.
