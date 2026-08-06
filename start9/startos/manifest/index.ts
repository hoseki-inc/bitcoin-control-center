import { setupManifest } from '@start9labs/start-sdk'

export const manifest = setupManifest({
  id: 'hoseki-sentinel',
  title: 'Bitcoin Control Center',
  license: 'Apache-2.0',
  packageRepo: 'https://github.com/hoseki-inc/bitcoin-control-center',
  upstreamRepo: 'https://github.com/hoseki-inc/bitcoin-control-center',
  marketingUrl: 'https://hoseki.app',
  donationUrl: null,
  docsUrls: ['https://help.hoseki.app'],
  description: {
    short: 'Self-hosted Bitcoin portfolio tracking with proof-of-reserves statements',
    long: 'Bitcoin Control Center is a self-hosted Bitcoin portfolio tracker. Connect your hardware wallets and watch-only accounts, track balances over time, and generate cryptographically verified proof-of-reserves statements — all running locally on your Start9 server with no cloud dependency. Connects to your local electrs instance for on-chain data.',
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
    electrs: {
      description: 'Required for on-chain Bitcoin data (address balances, transaction history).',
      optional: false,
      s9pk: null,
    },
  },
})
