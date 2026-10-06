// Seeds one Sentinel with a fictional demo portfolio through its tRPC API, so every preview shows the
// same data: two manual accounts with a year of activity, and one ETF account.
// Usage: node seed.mjs <port>
const port = process.argv[2]
const base = `http://localhost:${port}/trpc`

async function call(path, input) {
  const response = await fetch(`${base}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: input }),
  })
  const body = await response.json()
  if (!response.ok) {
    throw new Error(`${path}: ${response.status} ${JSON.stringify(body?.error?.json?.message ?? body)}`)
  }
  return body.result?.data?.json
}

const day = (iso) => `${iso}T12:00:00.000Z`
const btc = (amount) => String(Math.round(amount * 1e8))

// Cold Storage: a year of monthly buys.
const cold = await call('portalProve.manual.create', {
  displayName: 'Cold Storage',
  balanceSats: btc(0.5),
  balanceAsOf: day('2025-10-06'),
})
const monthlyBuys = [0.021, 0.018, 0.025, 0.015, 0.03, 0.019, 0.022, 0.017, 0.026, 0.02, 0.024, 0.016]
for (const [index, amount] of monthlyBuys.entries()) {
  const month = new Date(Date.UTC(2025, 10 + index, 6)).toISOString().slice(0, 10)
  await call('portalProve.manual.transactions.add', {
    accountId: cold.id,
    type: 'buy',
    amountSats: btc(amount),
    transactedAt: day(month),
    addToBalance: true,
  })
}

// Savings Vault: a few larger moves.
const vault = await call('portalProve.manual.create', {
  displayName: 'Savings Vault',
  balanceSats: btc(0.25),
  balanceAsOf: day('2026-02-10'),
})
for (const [type, amount, date] of [
  ['buy', 0.05, '2026-04-10'],
  ['buy', 0.08, '2026-07-10'],
  ['transfer_out', 0.03, '2026-08-20'],
]) {
  await call('portalProve.manual.transactions.add', {
    accountId: vault.id,
    type,
    amountSats: btc(amount),
    transactedAt: day(date),
    addToBalance: true,
  })
}

// Brokerage IRA: Bitcoin ETFs.
await call('portalProve.etf.create', {
  displayName: 'Brokerage IRA',
  holdings: [
    { ticker: 'IBIT', shares: '150', datePurchased: '2025-12-01' },
    { ticker: 'FBTC', shares: '60', datePurchased: '2026-03-15' },
  ],
})

console.log('seeded: Cold Storage, Savings Vault, Brokerage IRA')
