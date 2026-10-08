# @mint/tool-runtime

Portable tool registry and single-attempt runtime for Node.js. The package does not depend on Mint, Zod, a model SDK, a database, or an HTTP framework. Hosts provide tool validation, authorization, and invocation callbacks.

## Build and test

```sh
npm run build -w @mint/tool-runtime
npm test -w @mint/tool-runtime
npm pack -w @mint/tool-runtime
```

Node.js 20 or newer is required. The generated tarball can be installed from another Node.js project.

## Use

```ts
import { ToolRuntime, ToolRuntimeRegistry } from '@mint/tool-runtime';

const registry = new ToolRuntimeRegistry();
registry.register({ name: 'echo' });

const runtime = new ToolRuntime({
  registry,
  hooks: {
    isEnabled: () => true,
    validateInput: (_tool, input) =>
      typeof input === 'string' ? { valid: true } : { valid: false, error: 'string required' },
    authorize: (_tool, _input, context) =>
      context.approved
        ? { action: 'allow' }
        : { action: 'deny', code: 'DENIED', message: 'approval required' },
    execute: async (_tool, input) => input,
  },
});

const result = await runtime.run('echo', 'hello', { approved: true }, { signal });
```

The runtime rejects missing or disabled tools, validates input, requires the host authorization callback to allow execution, and handles cancellation, timeout, and normalized results. It runs one attempt. Hosts own retries, idempotency, persistence, and audit logging.
