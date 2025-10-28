export async function setup() {
  console.log('Global test setup starting...')
  
  // Set global test timeout
  process.env.VITEST_TIMEOUT = '60000'
  
  // Increase Node.js memory limit for tests
  if (!process.env.NODE_OPTIONS?.includes('--max-old-space-size')) {
    process.env.NODE_OPTIONS = (process.env.NODE_OPTIONS || '') + ' --max-old-space-size=4096'
  }
  
  // Enable garbage collection for memory tests
  if (!process.env.NODE_OPTIONS?.includes('--expose-gc')) {
    process.env.NODE_OPTIONS = (process.env.NODE_OPTIONS || '') + ' --expose-gc'
  }
  
  console.log('Global test setup complete')
}

export async function teardown() {
  console.log('Global test teardown starting...')
  
  // Clean up any global resources
  await new Promise(resolve => setTimeout(resolve, 1000))
  
  console.log('Global test teardown complete')
}