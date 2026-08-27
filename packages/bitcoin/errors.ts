import { ErrorWithTag } from '../result'

export class InvalidFormatError extends ErrorWithTag {
  public readonly tag = 'InvalidFormatError'
}
