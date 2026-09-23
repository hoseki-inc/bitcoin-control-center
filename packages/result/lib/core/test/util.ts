import { ErrorWithTag } from '../index'

export class TaggedError extends ErrorWithTag {
  readonly tag = 'TaggedError'
}
