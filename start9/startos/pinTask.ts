import { setPin } from './actions/setPin'
import { pinFile } from './fileModels/pinFile'
import { sdk } from './sdk'

// Fresh installs, and installs updated from before PINs, stop here until the owner sets one.
export const requirePin = sdk.setupOnInit(async (effects) => {
  if ((await pinFile.read((file) => file.pinSetAt).const(effects)) == null) {
    await sdk.action.createOwnTask(effects, setPin, 'critical', {
      reason: 'Set a PIN before using Bitcoin Control Center',
    })
  }
})
