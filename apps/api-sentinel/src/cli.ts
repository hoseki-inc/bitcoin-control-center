import { main } from './main'

main().catch((cause: unknown) => {
  console.error('Unhandled error in main:', cause)
  process.exit(1)
})
