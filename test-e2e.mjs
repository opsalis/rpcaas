import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();

  // Step 1: Open chainrpc.net
  console.log('1. Opening chainrpc.net...');
  await page.goto('https://chainrpc.net', { waitUntil: 'domcontentloaded', timeout: 30000 });
  const title = await page.title();
  console.log('   Page title:', title);
  await page.screenshot({ path: '/tmp/chainrpc-1-home.png' });

  // Step 2: Generate key
  console.log('2. Generating API key...');
  await page.click('#gen-btn');

  // Wait for key display (worker call)
  await page.waitForSelector('#key-display', { state: 'visible', timeout: 15000 });
  const key = await page.textContent('#key-text');
  console.log('   Generated key:', key.substring(0, 20) + '...');
  await page.screenshot({ path: '/tmp/chainrpc-2-key.png' });

  // Step 3: Verify usage snippet updated with key
  const snippet = await page.textContent('#key-url');
  console.log('   Snippet contains key:', snippet.includes(key.trim()));
  await page.screenshot({ path: '/tmp/chainrpc-3-snippet.png' });

  // Step 4: Test the actual RPC via API
  console.log('4. Testing RPC call with generated key...');
  const rpcResp = await page.evaluate(async (k) => {
    const r = await fetch('https://base.chainrpc.net/' + k, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 })
    });
    return r.json();
  }, key.trim());
  console.log('   RPC result:', JSON.stringify(rpcResp));

  // Step 5: Test account page
  console.log('5. Checking account page...');
  await page.goto('https://chainrpc.net/account.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.screenshot({ path: '/tmp/chainrpc-4-account.png' });
  console.log('   Account page loaded');

  await browser.close();

  if (!rpcResp.result) {
    console.error('FAILED: RPC call did not return a result', rpcResp);
    process.exit(1);
  }
  const blockNum = parseInt(rpcResp.result, 16);
  console.log('   Block number:', blockNum);
  console.log('SUCCESS: ChainRPC E2E test passed!');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
