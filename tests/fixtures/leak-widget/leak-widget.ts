/** Deliberate negative control. The browser collector must discover this call without a transport trace. */
export async function leakingReceipt(url: string, seed: string) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: `leak_${seed}`, method: 'eth_getTransactionReceipt', params: [`0x${'00'.repeat(32)}`] }) });
  return response.json();
}

export async function unexplainedRead(url: string, seed: string) {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: `untracked_${seed}`, method: 'eth_blockNumber', params: [] }) });
}
