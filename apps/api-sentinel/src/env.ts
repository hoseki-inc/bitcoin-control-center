import { z } from 'zod'

const EnvSchema = z.object({
  /** Host to bind the server to. Defaults to 'localhost'. */
  HOST: z.string().default('localhost'),
  /** Port number. Defaults to 3400. */
  PORT: z.coerce.number().int().positive().default(3400),

  /** Electrum server host. Required. */
  ELECTRUM_HOST: z.string(),
  /** Electrum server port. Defaults to 50001. */
  ELECTRUM_PORT: z.coerce.number().int().positive().default(50001),
  /** Electrum connection protocol. Defaults to 'tcp'. */
  ELECTRUM_PROTOCOL: z.enum(['tcp', 'ssl']).default('tcp'),

  /** Bitcoin network. Defaults to 'mainnet'. */
  BITCOIN_NETWORK: z.enum(['mainnet', 'testnet']).default('mainnet'),

  /** Directory to store the SQLite database and generated files. Defaults to './data'. */
  DATA_DIR: z.string().default('./data'),

  /** Directory containing bundled public assets. Defaults to the process working directory. */
  APP_DIR: z.string().default(process.cwd()),

  /** Primary mempool URL; statement quotes can fall back to public mempool.space. */
  MEMPOOL_API_URL: z.string().default('https://mempool.space'),

  /** Log level. Defaults to 'info'. */
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  /** Comma-separated hostnames allowed to serve the protected no-auth API. */
  SENTINEL_ALLOWED_HOSTS: z.string().optional(),
  /** Also allow any IP-literal host, for platforms that cannot report their addresses. Defaults to false. */
  SENTINEL_ALLOW_IP_HOSTS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /** Whether startup fails until Electrum connects. Set false where the server may still be indexing. Defaults to true. */
  SENTINEL_WAIT_FOR_ELECTRUM: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  /** SOCKS proxy host (set by desktop Electron shell when bundled Tor is running). */
  SOCKS_PROXY_HOST: z.string().optional(),
  /** SOCKS proxy port (set by desktop Electron shell when bundled Tor is running). */
  SOCKS_PROXY_PORT: z.coerce.number().int().positive().optional(),
})

export type Env = z.infer<typeof EnvSchema>

let cached: Env | null = null

export function loadEnv(): Env {
  if (cached) {
    return cached
  }
  cached = EnvSchema.parse(process.env)
  return cached
}
