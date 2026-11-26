export const RETRY_AFTER_SECONDS_DEFAULT = 60
export const VERIFY_LOGO_ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp']
export const CLAIM_LIMIT_DEFAULT = 10
export const MAX_BALANCE_CHECK_RATE_LIMIT_DEFAULT = 110
export const PROVE_USER_WELCOME_CREDITS = 5

const HELP_CENTER_URL = 'https://help.hoseki.app/bitcoin-control-center'
export const HELP_LINKS = {
  HOME: HELP_CENTER_URL,
  EXPORT_MULTISIG: `${HELP_CENTER_URL}/wallet-guides/export-multisig`,
  STATEMENTS: `${HELP_CENTER_URL}/statements/statements-and-hoseki-verified`,
} as const
