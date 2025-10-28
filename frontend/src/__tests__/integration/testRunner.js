#!/usr/bin/env node

/**
 * Comprehensive test runner for cross-browser and network resilience testing
 * This script orchestrates running tests across different scenarios and environments
 */

import { spawn } from 'child_process'
import { writeFileSync, readFileSync } from 'fs'
import { join } from 'path'

const TEST_RESULTS_FILE = 'test-results.json'
const TEST_TIMEOUT = 300000 // 5 minutes per test suite

class TestRunner {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch
      },
      testSuites: [],
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0
      }
    }
  }

  async runTestSuite(name, command, args = [], options = {}) {
    console.log(`\n🧪 Running ${name}...`)
    console.log(`Command: ${command} ${args.join(' ')}`)
    
    const startTime = Date.now()
    
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        stdio: 'pipe',
        shell: true,
        timeout: TEST_TIMEOUT,
        ...options
      })

      let stdout = ''
      let stderr = ''

      child.stdout?.on('data', (data) => {
        const output = data.toString()
        stdout += output
        process.stdout.write(output)
      })

      child.stderr?.on('data', (data) => {
        const output = data.toString()
        stderr += output
        process.stderr.write(output)
      })

      child.on('close', (code) => {
        const endTime = Date.now()
        const duration = endTime - startTime

        const result = {
          name,
          command: `${command} ${args.join(' ')}`,
          exitCode: code,
          duration,
          stdout,
          stderr,
          success: code === 0,
          timestamp: new Date().toISOString()
        }

        this.results.testSuites.push(result)
        
        if (code === 0) {
          console.log(`✅ ${name} passed (${duration}ms)`)
          this.results.summary.passed++
        } else {
          console.log(`❌ ${name} failed with code ${code} (${duration}ms)`)
          this.results.summary.failed++
        }
        
        this.results.summary.total++
        resolve(result)
      })

      child.on('error', (error) => {
        console.error(`💥 ${name} error:`, error.message)
        
        const result = {
          name,
          command: `${command} ${args.join(' ')}`,
          exitCode: -1,
          duration: Date.now() - startTime,
          stdout,
          stderr: stderr + error.message,
          success: false,
          error: error.message,
          timestamp: new Date().toISOString()
        }

        this.results.testSuites.push(result)
        this.results.summary.failed++
        this.results.summary.total++
        resolve(result)
      })
    })
  }

  async runAllTests() {
    console.log('🚀 Starting comprehensive cross-browser and network resilience testing...')
    console.log(`Environment: ${this.results.environment.platform} ${this.results.environment.arch}`)
    console.log(`Node.js: ${this.results.environment.node}`)
    
    // Test suites to run
    const testSuites = [
      {
        name: 'Network Resilience Tests',
        command: 'npm',
        args: ['run', 'test', '--', 'src/__tests__/integration/networkResilience.test.js', '--run']
      },
      {
        name: 'Cross-Browser Compatibility Tests',
        command: 'npm',
        args: ['run', 'test', '--', 'src/__tests__/integration/crossBrowserCompatibility.test.js', '--run']
      },
      {
        name: 'Server Load Testing',
        command: 'npm',
        args: ['run', 'test:server', '--', 'server/__tests__/performance/loadTesting.test.js']
      },
      {
        name: 'Integration Game Flow Tests',
        command: 'npm',
        args: ['run', 'test', '--', 'src/__tests__/integration/gameFlow.test.js', '--run']
      },
      {
        name: 'End-to-End Gameplay Scenarios',
        command: 'npm',
        args: ['run', 'test', '--', 'src/__tests__/e2e/gameplayScenarios.test.js', '--run']
      }
    ]

    // Run tests sequentially to avoid resource conflicts
    for (const suite of testSuites) {
      await this.runTestSuite(suite.name, suite.command, suite.args)
      
      // Brief pause between test suites
      await new Promise(resolve => setTimeout(resolve, 2000))
    }

    this.generateReport()
  }

  generateReport() {
    console.log('\n📊 Test Results Summary')
    console.log('=' .repeat(50))
    console.log(`Total Test Suites: ${this.results.summary.total}`)
    console.log(`✅ Passed: ${this.results.summary.passed}`)
    console.log(`❌ Failed: ${this.results.summary.failed}`)
    console.log(`⏭️  Skipped: ${this.results.summary.skipped}`)
    
    const successRate = this.results.summary.total > 0 
      ? (this.results.summary.passed / this.results.summary.total * 100).toFixed(1)
      : 0
    console.log(`📈 Success Rate: ${successRate}%`)

    // Detailed results
    console.log('\n📋 Detailed Results:')
    this.results.testSuites.forEach((suite, index) => {
      const status = suite.success ? '✅' : '❌'
      const duration = (suite.duration / 1000).toFixed(2)
      console.log(`${index + 1}. ${status} ${suite.name} (${duration}s)`)
      
      if (!suite.success && suite.stderr) {
        console.log(`   Error: ${suite.stderr.split('\n')[0]}`)
      }
    })

    // Performance insights
    console.log('\n⚡ Performance Insights:')
    const totalDuration = this.results.testSuites.reduce((sum, suite) => sum + suite.duration, 0)
    console.log(`Total execution time: ${(totalDuration / 1000).toFixed(2)}s`)
    
    const avgDuration = totalDuration / this.results.testSuites.length
    console.log(`Average test suite duration: ${(avgDuration / 1000).toFixed(2)}s`)

    // Save detailed results to file
    try {
      writeFileSync(TEST_RESULTS_FILE, JSON.stringify(this.results, null, 2))
      console.log(`\n💾 Detailed results saved to ${TEST_RESULTS_FILE}`)
    } catch (error) {
      console.error('Failed to save results:', error.message)
    }

    // Exit with appropriate code
    const exitCode = this.results.summary.failed > 0 ? 1 : 0
    console.log(`\n🏁 Testing complete. Exit code: ${exitCode}`)
    
    return exitCode
  }

  async runBrowserSpecificTests() {
    console.log('\n🌐 Running browser-specific compatibility tests...')
    
    const browserTests = [
      {
        name: 'Chrome WebSocket Compatibility',
        env: { BROWSER_TYPE: 'chrome' }
      },
      {
        name: 'Firefox WebSocket Compatibility', 
        env: { BROWSER_TYPE: 'firefox' }
      },
      {
        name: 'Safari WebSocket Compatibility',
        env: { BROWSER_TYPE: 'safari' }
      },
      {
        name: 'Edge WebSocket Compatibility',
        env: { BROWSER_TYPE: 'edge' }
      }
    ]

    for (const test of browserTests) {
      await this.runTestSuite(
        test.name,
        'npm',
        ['run', 'test', '--', 'src/__tests__/integration/crossBrowserCompatibility.test.js', '--run'],
        { env: { ...process.env, ...test.env } }
      )
    }
  }

  async runNetworkConditionTests() {
    console.log('\n🌐 Running network condition tests...')
    
    const networkTests = [
      {
        name: 'High Latency Network Test',
        env: { NETWORK_LATENCY: '1000' }
      },
      {
        name: 'Packet Loss Network Test',
        env: { NETWORK_PACKET_LOSS: '0.1' }
      },
      {
        name: 'Low Bandwidth Network Test',
        env: { NETWORK_BANDWIDTH: 'low' }
      },
      {
        name: 'Unstable Network Test',
        env: { NETWORK_STABILITY: 'unstable' }
      }
    ]

    for (const test of networkTests) {
      await this.runTestSuite(
        test.name,
        'npm',
        ['run', 'test', '--', 'src/__tests__/integration/networkResilience.test.js', '--run'],
        { env: { ...process.env, ...test.env } }
      )
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2)
  const runner = new TestRunner()

  if (args.includes('--browser-only')) {
    await runner.runBrowserSpecificTests()
  } else if (args.includes('--network-only')) {
    await runner.runNetworkConditionTests()
  } else if (args.includes('--comprehensive')) {
    await runner.runAllTests()
    await runner.runBrowserSpecificTests()
    await runner.runNetworkConditionTests()
  } else {
    await runner.runAllTests()
  }

  const exitCode = runner.generateReport()
  process.exit(exitCode)
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Test runner failed:', error)
    process.exit(1)
  })
}

export default TestRunner