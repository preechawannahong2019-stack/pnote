export default [
  { test: { name: 'core', root: './packages/core', environment: 'node', globals: true } },
  { test: { name: 'ink', root: './packages/ink', environment: 'jsdom', globals: true, setupFiles: ['./test/setup.ts'] } },
  { test: { name: 'pdf', root: './packages/pdf', environment: 'node', globals: true, testTimeout: 20000 } },
  { test: { name: 'storage', root: './packages/storage', environment: 'node', globals: true } },
  './apps/web/vite.config.ts',
];
