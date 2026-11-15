import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import 'vitest-canvas-mock';
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
