import { main } from './main'

const desktop = process.argv.includes('--desktop')
main(desktop ? { connectionProfiles: true, waitForElectrum: false } : {}).catch((error) => {
  console.error('Unhandled error in main:', error)
  process.exit(1)
})
