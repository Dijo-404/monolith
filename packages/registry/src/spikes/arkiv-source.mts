// One public source record for the isolated feasibility experiment, not the MN-008 import.
export const SOURCE = {
  commit: 'e17474286275730fb6b0490b1d7ea1c64a36ed9e',
  url: 'https://github.com/ethereum-lists/chains/blob/e17474286275730fb6b0490b1d7ea1c64a36ed9e/_data/chains/eip155-1.json',
  licenseUrl: 'https://github.com/ethereum-lists/chains/blob/e17474286275730fb6b0490b1d7ea1c64a36ed9e/LICENSE',
  snapshotSha256: '2cded1d8854ffecda7ca17752eb482592eacf66cd62907117128fefe2cedecf3',
} as const;

export function sampleValues(runId: string, observedAt: string) {
  return {
    chain_id: '1',
    chain_name: 'Ethereum Mainnet',
    rpc_host: 'https://ethereum-rpc.publicnode.com',
    network_type: 'ethereum',
    status: 'candidate',
    source_url: SOURCE.url,
    source_commit: SOURCE.commit,
    source_license: SOURCE.licenseUrl,
    snapshot_sha256: SOURCE.snapshotSha256,
    observed_at: observedAt,
    measured_chain_id: '',
    run_id: runId,
    evidence: 'SIMULATED',
  };
}
