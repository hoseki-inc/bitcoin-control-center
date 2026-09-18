import { z } from 'zod'

export const coercedBoolean = z.preprocess((value) => {
  if (typeof value === 'string') {
    const lowerValue = value.toLowerCase()
    if (lowerValue === 'true') {
      return true
    }
    if (lowerValue === 'false') {
      return false
    }
  }
  return Boolean(value)
}, z.boolean())
