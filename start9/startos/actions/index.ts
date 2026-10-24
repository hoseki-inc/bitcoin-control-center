import { sdk } from '../sdk'
import { configure } from './configure'
import { setPin } from './setPin'

export const actions = sdk.Actions.of().addAction(setPin).addAction(configure)
