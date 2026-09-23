import { Navigate, Route, Routes } from 'react-router'
import { AppLayout } from './components/layout/app-layout'
import { KeystoreReceiptPage } from './components/multisig/keystore-receipt'
import { MultisigPageWrapper } from './components/multisig/multisig-page-wrapper'
import { NotFound } from './components/not-found'
import { GettingStarted } from './components/onboarding/getting-started'
import { WelcomeReveal } from './components/onboarding/welcome-reveal'
// Prove pages
import { HomePage } from './pages'
import { ClaimsPage } from './pages/claims'
import { ClaimDetailsPage } from './pages/claims/[id]'
import { SinglesigSigningPage } from './pages/claims/[id]/signing'
import { AddAccountPage } from './pages/claims/add'
import { CoinbaseAccountDetailsPage } from './pages/claims/coinbase/[id]'
import { EtfAccountDetailsPage } from './pages/claims/etf/[id]'
import { KrakenAccountDetailsPage } from './pages/claims/kraken/[id]'
import { ManualAccountDetailsPage } from './pages/claims/manual/[id]'
import { RobinhoodAccountDetailsPage } from './pages/claims/robinhood/[id]'
import { StrikeAccountDetailsPage } from './pages/claims/strike/[id]'
import {
  ClaimVerificationReceiptPage,
  ClaimsVerifyAdvancedPage,
  ClaimsVerifyColdcardPage,
  ClaimsVerifyKeystonePage,
  ClaimsVerifyLedgerPage,
  ClaimsVerifyTrezorPage,
} from './pages/claims/verify'
import { ClaimsVerifyCoinbasePage } from './pages/claims/verify/coinbase'
import { ClaimsVerifyEtfPage } from './pages/claims/verify/etf'
import { ClaimsVerifyKrakenPage } from './pages/claims/verify/kraken'
import { ClaimsVerifyManualPage } from './pages/claims/verify/manual'
import { ManualTypeSelectorPage } from './pages/claims/verify/manual-type'
import { ClaimsVerifyRobinhoodPage } from './pages/claims/verify/robinhood'
import { ClaimsVerifyStrikePage } from './pages/claims/verify/strike'
import { DashboardPage } from './pages/dashboard'
import { HardwareWalletTestPage } from './pages/hardware-wallet-test'
import { MultisigDetailsPage } from './pages/multisig/[id]'
import { MultisigConnectPage } from './pages/multisig/[id]/connect'
import { MultisigSigningPage } from './pages/multisig/[id]/signing'
import { MultisigCreatePage } from './pages/multisig/create'
import { SettingsPage } from './pages/settings'
import { StatementListPage } from './pages/statements'
import { StatementDetailsPage } from './pages/statements/[id]'
import { StatementCreatePage } from './pages/statements/create'

// Multisig

export default function AppRoutes(): JSX.Element {
  return (
    <WelcomeReveal>
      <Routes>
        <Route element={<AppLayout fullWidth />}>
          <Route path="portfolio" Component={DashboardPage} />
        </Route>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/home" replace />} />
          <Route path="home" Component={HomePage} />
          <Route path="getting-started" Component={GettingStarted} />

          <Route path="accounts">
            <Route path="" Component={ClaimsPage} />
            <Route path="add" Component={AddAccountPage} />
            <Route path="coinbase/:accountId" Component={CoinbaseAccountDetailsPage} />
            <Route path="kraken/:accountId" Component={KrakenAccountDetailsPage} />
            <Route path="robinhood/:accountId" Component={RobinhoodAccountDetailsPage} />
            <Route path="strike/:accountId" Component={StrikeAccountDetailsPage} />
            <Route path="manual/:accountId" Component={ManualAccountDetailsPage} />
            <Route path="etf/:accountId" Component={EtfAccountDetailsPage} />
            <Route path=":claimId">
              <Route index Component={ClaimDetailsPage} />
              <Route path="signing" Component={SinglesigSigningPage} />
            </Route>
            <Route path="verify">
              <Route path="trezor" Component={ClaimsVerifyTrezorPage} />
              <Route path="ledger" Component={ClaimsVerifyLedgerPage} />
              <Route path="coldcard" Component={ClaimsVerifyColdcardPage} />
              <Route path="keystone" Component={ClaimsVerifyKeystonePage} />
              <Route path="advanced" Component={ClaimsVerifyAdvancedPage} />
              <Route path="coinbase" Component={ClaimsVerifyCoinbasePage} />
              <Route path="kraken" Component={ClaimsVerifyKrakenPage} />
              <Route path="robinhood" Component={ClaimsVerifyRobinhoodPage} />
              <Route path="strike" Component={ClaimsVerifyStrikePage} />
              <Route path="manual-type" Component={ManualTypeSelectorPage} />
              <Route path="manual" Component={ClaimsVerifyManualPage} />
              <Route path="etf" Component={ClaimsVerifyEtfPage} />
            </Route>
          </Route>

          <Route path="statements">
            <Route path="" Component={StatementListPage} />
            <Route path="create" Component={StatementCreatePage} />
          </Route>

          <Route path="settings" Component={SettingsPage} />

          <Route path="multisig">
            <Route index element={<Navigate to="/multisig/create" replace />} />
            <Route path="create" Component={MultisigCreatePage} />
            <Route path=":claimId" element={<MultisigPageWrapper />}>
              <Route index Component={MultisigDetailsPage} />
              <Route path="connect/:walletType/:keystoreId" Component={MultisigConnectPage} />
              <Route path="signing/:walletType/:keystoreId" Component={MultisigSigningPage} />
            </Route>
          </Route>
        </Route>
        <Route element={<AppLayout fullWidth />}>
          <Route path="statements/:statementId" Component={StatementDetailsPage} />
        </Route>
        <Route path="/accounts/verify/receipt/:claimId" Component={ClaimVerificationReceiptPage} />
        <Route path="/multisig/verify/receipt/:claimId/:keystoreId" Component={KeystoreReceiptPage} />

        <Route path="/test/hardware-wallets" Component={HardwareWalletTestPage} />

        <Route path="*" Component={NotFound} />
      </Routes>
    </WelcomeReveal>
  )
}
