/** The stored network name for a claim's network. */
export function claimNetworkToNetwork(claimNetwork: string): string {
  return claimNetwork === 'bitcoin_testnet' ? 'testnet' : 'mainnet'
}
