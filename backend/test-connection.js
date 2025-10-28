// Simple test script to verify WebSocket server functionality
const WebSocket = require('ws');

// Test configuration
const SERVER_URL = 'ws://localhost:8080';
const TEST_TIMEOUT = 5000;

async function testWebSocketConnection() {
  console.log('Testing WebSocket server connection...');
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Connection test timed out'));
    }, TEST_TIMEOUT);

    try {
      const ws = new WebSocket(SERVER_URL);
      
      ws.on('open', () => {
        console.log('✓ WebSocket connection established');
        
        // Test ping message
        ws.send(JSON.stringify({
          type: 'ping',
          timestamp: Date.now()
        }));
      });
      
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          console.log('✓ Received message:', message.type);
          
          if (message.type === 'pong') {
            console.log('✓ Ping/pong test successful');
            clearTimeout(timeout);
            ws.close();
            resolve();
          }
        } catch (error) {
          console.error('✗ Error parsing message:', error);
          clearTimeout(timeout);
          ws.close();
          reject(error);
        }
      });
      
      ws.on('error', (error) => {
        console.error('✗ WebSocket error:', error.message);
        clearTimeout(timeout);
        reject(error);
      });
      
      ws.on('close', () => {
        console.log('WebSocket connection closed');
      });
      
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}

// Only run test if this file is executed directly
if (require.main === module) {
  testWebSocketConnection()
    .then(() => {
      console.log('✓ All tests passed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('✗ Test failed:', error.message);
      process.exit(1);
    });
}

module.exports = testWebSocketConnection;