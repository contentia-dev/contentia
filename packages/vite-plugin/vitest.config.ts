import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The typegen tests run the real TypeScript compiler. Its first load is
    // sub-second locally but took over 5s on a CI runner busy with every other
    // package's tests, so the default 5s timeout fails whichever test loads it.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
