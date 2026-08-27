import { sdk } from '../sdk'
import { configure } from './configure'

export const actions = sdk.Actions.of().addAction(configure)
