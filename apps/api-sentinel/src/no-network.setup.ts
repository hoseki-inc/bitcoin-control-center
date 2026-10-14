// Tests never reach real price sources or anything else off this machine, even by accident.
// Test servers listen on loopback; the opt-in live parity check is the one exception.
const realFetch = globalThis.fetch
if (process.env['STATEMENT_LIVE_PARITY'] !== '1') {
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error(`Tests must not contact ${url.origin}`)
    }
    return realFetch(input, init)
  }
}
