import { useLocation, useNavigate } from 'react-router'
import { AddAccountFlow } from '../../components/claims/add-account-flow'
import { parseNavigationState } from '../../lib/navigation-state'

export function AddAccountPage(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  // Back returns to the page that offered to add an account.
  const returnTo = parseNavigationState(location.state)?.returnTo ?? '/accounts'
  return (
    <AddAccountFlow
      onClose={() => {
        void navigate(returnTo)
      }}
      linkState={{ returnTo: '/accounts/add' }}
    />
  )
}
