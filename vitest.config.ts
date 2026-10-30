import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    fileParallelism: false,
    testTimeout: 20_000,
    env: {
      NODE_ENV: 'test',
      APP_NAME: 'Aurum Test',
      EXPOSE_RESET_TOKEN: 'true',
      // Keep the suite deterministic even when a developer has a real .env.
      TURNSTILE_ENABLED: 'false',
      TURNSTILE_SECRET_KEY: '',
    },
  },
});
