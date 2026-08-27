const FLOW_SOURCE_KEY = 'flowSource'

type FlowSource = {
  type: 'statement'
}

function setFlowSource(source: FlowSource): void {
  localStorage.setItem(FLOW_SOURCE_KEY, JSON.stringify(source))
}

export function getFlowSource(): FlowSource | null {
  const source = localStorage.getItem(FLOW_SOURCE_KEY)
  return source ? JSON.parse(source) : null
}

export function clearFlowSource(): void {
  localStorage.removeItem(FLOW_SOURCE_KEY)
}

export function setIsInGenerateStatementFlow(): void {
  setFlowSource({ type: 'statement' })
}
