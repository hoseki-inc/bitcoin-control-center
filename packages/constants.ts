export const RETRY_AFTER_SECONDS_DEFAULT = 60
export const VERIFY_LOGO_ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp']
export const HOSEKI_ASSETS_CDN_HOSTNAME = 'assets.hoseki.app'
export const HOSEKI_ASSETS_CDN_URL = `https://${HOSEKI_ASSETS_CDN_HOSTNAME}`
export const CLAIM_LIMIT_DEFAULT = 10
export const MAX_BALANCE_CHECK_RATE_LIMIT_DEFAULT = 110
export const PROVE_USER_WELCOME_CREDITS = 5
export const HOSEKI_ASSETS_CDN_URLS = {
  COIN_LOGOS: {
    BTC: `${HOSEKI_ASSETS_CDN_URL}/coin_logos/btc.svg`,
    ETH: `${HOSEKI_ASSETS_CDN_URL}/coin_logos/eth.svg`,
    SOL: `${HOSEKI_ASSETS_CDN_URL}/coin_logos/sol.svg`,
    USDC: `${HOSEKI_ASSETS_CDN_URL}/coin_logos/usdc.svg`,
    USDT: `${HOSEKI_ASSETS_CDN_URL}/coin_logos/usdt.svg`,
  } as const,
} as const
