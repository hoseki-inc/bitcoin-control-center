import { Result, parseUnknown } from '@hoseki/packages/result'
import { z } from 'zod'

const FLOW_SOURCE_KEY = 'flowSource'

const FlowSourceSchema = z.object({ type: z.literal('statement') })
type FlowSource = z.infer<typeof FlowSourceSchema>

function setFlowSource(source: FlowSource): void {
  localStorage.setItem(FLOW_SOURCE_KEY, JSON.stringify(source))
}

export function getFlowSource(): FlowSource | null {
  const source = localStorage.getItem(FLOW_SOURCE_KEY)
  if (source == null || source === '') {
    return null
  }
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- localStorage JSON remains unknown until FlowSourceSchema validates it.
  return Result.fromThrowable((): unknown => JSON.parse(source))
    .andThen((parsed) => parseUnknown(FlowSourceSchema, parsed))
    .unwrapOr(null)
}

export function clearFlowSource(): void {
  localStorage.removeItem(FLOW_SOURCE_KEY)
}

export function setIsInGenerateStatementFlow(): void {
  setFlowSource({ type: 'statement' })
}
