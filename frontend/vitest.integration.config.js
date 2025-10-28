import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    name: 'integration',
    include: ['src/__tests__/integration/**/*.test.js'],
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
    maxConcurrency: 1, // Run integration tests sequentially
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true
      }
    },
    setupFiles: ['src/__tests__/setup/integration.setup.js'],
    globalSetup: ['src/__tests__/setup/global.setup.js'],
    env: {
      NODE_ENV: 'test',
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || 'test-key',
      SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY || 'test-service-key'
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  }
})