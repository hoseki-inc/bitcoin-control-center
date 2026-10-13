import { z } from 'zod'

/**
 * Navigation state Generate passes to the statement page: the statement it opens came from Sentinel
 * a moment ago, so the page needn't confirm its status before showing generation.
 */
export const JUST_GENERATED_STATE = { justGenerated: true } as const

export const JustGeneratedStateSchema = z.object({ justGenerated: z.literal(true) })
