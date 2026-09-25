import { useNavigate } from 'react-router'
import { AddAccountFlow } from '../../components/claims/add-account-flow'

export function AddAccountPage(): JSX.Element {
  const navigate = useNavigate()
  return (
    <AddAccountFlow
      onClose={() => {
        void navigate('/accounts')
      }}
      linkState={{ returnTo: '/accounts/add' }}
    />
  )
}
