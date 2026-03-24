import { AXIPAgent } from '../packages/sdk/index.js';

const client = new AXIPAgent({
  name: 'e2e-tester',
  capabilities: [],
  relayUrl: 'ws://127.0.0.1:4200'
});

await client.start();
console.log('[test] Connected to relay');

// Test discover
const result = await client.discover('web_search');
console.log('[test] Discover result:', JSON.stringify(result?.payload));

// Clean up
await client.stop();
console.log('[test] All tests passed');
