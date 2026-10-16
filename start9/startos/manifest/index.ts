import { setupManifest } from '@start9labs/start-sdk'

export const manifest = setupManifest({
  id: 'hoseki-sentinel',
  title: 'Bitcoin Control Center',
  license: 'Apache-2.0',
  packageRepo: 'https://github.com/hoseki-inc/bitcoin-control-center',
  upstreamRepo: 'https://github.com/hoseki-inc/bitcoin-control-center',
  marketingUrl: 'https://www.bitcoincontrolcenter.com',
  donationUrl: null,
  description: {
    short: 'Privacy-first Bitcoin accounting for your stack',
    long: 'Bitcoin Control Center is privacy-first accounting for your stack. Connect hardware wallets, watch-only accounts, exchanges, and ETFs to track Bitcoin balances over time. Be your own bank with cryptographically verified proof-of-ownership statements. Self-custody data comes through an Electrum server you choose, preferably your own.',
  },
  volumes: ['main'],
  images: {
    main: {
      source: {
        dockerBuild: {
          dockerfile: 'Dockerfile',
          workdir: '..',
        },
      },
      arch: ['x86_64', 'aarch64'],
    },
  },
  alerts: {
    install: null,
    update: null,
    uninstall: null,
    restore: null,
    start: null,
    stop: null,
  },
  dependencies: {
    mempool: {
      description: 'Required for Bitcoin prices and transaction details in statements.',
      optional: false,
      s9pk: null,
    },
    electrs: {
      description: 'Required for on-chain Bitcoin data (address balances, transaction history).',
      optional: false,
      s9pk: null,
    },
  },
})
