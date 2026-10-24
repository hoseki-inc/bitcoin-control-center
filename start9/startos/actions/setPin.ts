import { pinFile } from '../fileModels/pinFile'
import { sdk } from '../sdk'

const pinField = (name: string) =>
  sdk.Value.text({
    name,
    required: true,
    default: null,
    masked: true,
    minLength: 6,
    maxLength: 6,
    inputmode: 'tel',
    patterns: [{ regex: '^[0-9]{6}$', description: 'Use exactly 6 digits.' }],
  })

const inputSpec = sdk.InputSpec.of({
  pin: pinField('PIN'),
  confirm: pinField('Confirm PIN'),
})

export const setPin = sdk.Action.withInput(
  'set-pin',
  {
    name: 'Set PIN',
    description:
      'Choose the 6-digit PIN you’ll use to open Bitcoin Control Center. Running this again replaces it and signs everyone out.',
    warning: null,
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  },
  inputSpec,
  // Never prefill a PIN.
  async () => null,
  async ({ effects, input }) => {
    if (input.pin !== input.confirm) {
      throw new Error('The PINs don’t match.')
    }
    // Sentinel hashes the PIN, read from stdin so it never appears in a command line, and applies it when it
    // next starts. Writing pin.json restarts it (main watches the file).
    await sdk.SubContainer.withTemp(
      effects,
      { imageId: 'main' },
      sdk.Mounts.of().mountVolume({ volumeId: 'main', subpath: null, mountpoint: '/data', readonly: false }),
      'set-pin',
      async (subcontainer) =>
        subcontainer.execFail(['node', '/app/dist/cli.js', 'set-pin'], {
          env: { DATA_DIR: '/data' },
          input: input.pin,
        }),
    )
    await pinFile.merge(effects, { pinSetAt: Date.now() })
    return null
  },
)
