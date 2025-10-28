import { beforeAll, afterAll } from 'vitest'
import { config } from 'dotenv'

// Load environment variables
config()

// Global test setup for integration tests
beforeAll(async () => {
  console.log('Setting up integration test environment...')
  
  // Set test-specific environment variables
  process.env.NODE_ENV = 'test'
  process.env.PORT = process.env.TEST_PORT || '8081'
  
  // Ensure required environment variables are set
  if (!process.env.VITE_SUPABASE_URL) {
    console.warn('VITE_SUPABASE_URL not set, using default test URL')
    process.env.VITE_SUPABASE_URL = 'http://localhost:54321'
  }
  
  if (!process.env.VITE_SUPABASE_ANON_KEY) {
    console.warn('VITE_SUPABASE_ANON_KEY not set, using test key')
    process.env.VITE_SUPABASE_ANON_KEY = 'test-key'
  }
  
  if (!process.env.SUPABASE_SERVICE_KEY) {
    console.warn('SUPABASE_SERVICE_KEY not set, using test service key')
    process.env.SUPABASE_SERVICE_KEY = 'test-service-key'
  }
  
  console.log('Integration test environment ready')
})

afterAll(async () => {
  console.log('Cleaning up integration test environment...')
  
  // Clean up any global resources
  // Force garbage collection if available
  if (global.gc) {
    global.gc()
  }
  
  console.log('Integration test cleanup complete')
})