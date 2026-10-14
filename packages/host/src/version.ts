import { createRequire } from 'node:module';

// Both src/ and dist/ sit one level below the host package, so this resolves to the host's own
// package.json from the dev runner and from the built output.
const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

export const HOST_VERSION: string = pkg.version;
