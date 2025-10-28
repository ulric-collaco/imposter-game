import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'browser-compatibility',
    environment: 'jsdom',
    setupFiles: ['src/__tests__/setup/integration.setup.js'],
    include: [
      'src/__tests__/integration/crossBrowserCompatibility.test.js',
      'src/__tests__/integration/networkResilience.test.js'
    ],
    testTimeout: 30000,
    hookTimeout: 10000,
    teardownTimeout: 5000,
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/__tests__/',
        '**/*.config.js',
        'dist/'
      ]
    },
    // Browser-specific test configuration
    env: {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || 'test-key',
      VITE_WEBSOCKET_URL: process.env.VITE_WEBSOCKET_URL || 'ws://localhost:8080',
      NODE_ENV: 'test'
    },
    // Retry configuration for flaky network tests
    retry: {
      // Retry network-related tests up to 2 times
      'src/__tests__/integration/networkResilience.test.js': 2,
      // Browser compatibility tests should be more stable
      'src/__tests__/integration/crossBrowserCompatibility.test.js': 1
    },
    // Test sequencing to avoid resource conflicts
    sequence: {
      concurrent: false, // Run tests sequentially for network tests
      shuffle: false     // Maintain test order for consistency
    },
    // Reporter configuration
    reporter: [
      'verbose',
      'json',
      ['html', { outputFile: 'test-results/browser-compatibility.html' }]
    ],
    outputFile: {
      json: 'test-results/browser-compatibility.json'
    }
  },
  resolve: {
    alias: {
      '@': '/src'
    }
  },
  define: {
    // Define browser-specific globals for testing
    __BROWSER_TYPE__: JSON.stringify(process.env.BROWSER_TYPE || 'chrome'),
    __NETWORK_CONDITIONS__: JSON.stringify({
      latency: parseInt(process.env.NETWORK_LATENCY || '0'),
      packetLoss: parseFloat(process.env.NETWORK_PACKET_LOSS || '0'),
      bandwidth: process.env.NETWORK_BANDWIDTH || 'high',
      stability: process.env.NETWORK_STABILITY || 'stable'
    })
  }
})