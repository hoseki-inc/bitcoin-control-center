import { resolve } from 'path'
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  // NOTE: This is needed for images, such as the ones in <ClaimCard />
  // We may have to use another approach if we use Ladle for other web apps with different public directories
  publicDir: resolve(import.meta.dirname, '../apps/control-center/public'),
  plugins: [
    nodePolyfills({
      include: ['buffer'],
      globals: {
        // Note, Vini, 2025-12-16: This had to be introduced when I moved bitcoin input fields to the
        // design system package because bitcoinjs-lib (used by the bitcoin package) requires Node.js
        // globals like Buffer, but Ladle runs in the browser where Buffer isn't available.
        Buffer: true,
      },
    }),
  ],
})
