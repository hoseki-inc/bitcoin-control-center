import type { FeatureRoute } from '..'
import { ClaimsVerifyEtfPage } from './add-etf-holdings-page'
import { EtfAccountDetailsPage } from './etf-account-page'

export const routes: FeatureRoute[] = [
  { path: 'accounts/etf/:accountId', Component: EtfAccountDetailsPage },
  { path: 'accounts/verify/etf', Component: ClaimsVerifyEtfPage },
]
