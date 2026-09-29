import { parseUnknown } from '@hoseki/packages/result'
import { ClaimIdSchema, StatementIdSchema } from '@hoseki/packages/schemas/prove'
import { useParams } from 'react-router'
import type { z } from 'zod'

export enum UrlParameter {
  claimId = 'claimId',
  statementId = 'statementId',
}

const SCHEMA_MAP = {
  [UrlParameter.claimId]: ClaimIdSchema,
  [UrlParameter.statementId]: StatementIdSchema,
}

export function useUrlParameter<K extends UrlParameter>(urlParameter: K): z.infer<(typeof SCHEMA_MAP)[K]> | null {
  const params = useParams()
  const schema = SCHEMA_MAP[urlParameter]
  return parseUnknown(schema, params[urlParameter]).unwrapOr(null)
}
