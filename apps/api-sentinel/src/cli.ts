import { main } from './main'

main().catch((error: unknown) => {
  console.error('Unhandled error in main:', error)
  process.exit(1)
})
