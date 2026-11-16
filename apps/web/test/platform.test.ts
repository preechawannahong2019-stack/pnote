import { IndexedDbAdapter } from '@pnote/storage/idb-adapter';
import { createPlatformServices, platformKind } from '../src/platform';

describe('platform', () => {
  it('is web without Capacitor', () => {
    expect(platformKind(undefined)).toBe('web');
    expect(platformKind({ isNativePlatform: () => false, getPlatform: () => 'web' })).toBe('web');
  });
  it('detects android and ios', () => {
    expect(platformKind({ isNativePlatform: () => true, getPlatform: () => 'android' })).toBe('android');
    expect(platformKind({ isNativePlatform: () => true, getPlatform: () => 'ios' })).toBe('ios');
  });
  it('builds web services', async () => {
    const s = await createPlatformServices('web');
    expect(s.kind).toBe('web');
    expect(s.adapter).toBeInstanceOf(IndexedDbAdapter);
    expect(s.device.available).toBe(false);
  });
});
