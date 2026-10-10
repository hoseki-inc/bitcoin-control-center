import type { StatementDto } from '../trpc/server-types'

/** How often a statements list refreshes while one of its statements is generating. */
const GENERATING_POLL_MS = 2000

/** `refetchInterval` for statement lists: keep statuses current only while something is generating. */
export function refetchWhileGenerating(statements: StatementDto[] | undefined): number | false {
  return statements?.some((statement) => statement.status === 'pending') === true ? GENERATING_POLL_MS : false
}
