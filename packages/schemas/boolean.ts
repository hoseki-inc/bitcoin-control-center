import { z } from 'zod'
import { parseUnknown } from '../result/lib/parse'

export const coercedBoolean = z.preprocess((value) => {
  const text = parseUnknown(z.string(), value)
  if (text.isOk()) {
    const lowerValue = text.unwrap().toLowerCase()
    if (lowerValue === 'true') {
      return true
    }
    if (lowerValue === 'false') {
      return false
    }
  }
  return Boolean(value)
}, z.boolean())
