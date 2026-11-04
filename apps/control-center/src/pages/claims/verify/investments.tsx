import { Box, FormControl, FormLabel, Input, Stack } from '@chakra-ui/react'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { TopBar } from '@hoseki/packages/ui/prove-verify-ui/top-bar'
import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { toast } from 'sonner'
import { afterAtLeastASecond } from '../../../components/claims/holdings-added'
import { InvestmentsAdded, InvestmentsAdding } from '../../../components/investments/investment-added'
import { type ValuationFields, ValuationForm } from '../../../components/investments/valuation-form'
import { parseNavigationState } from '../../../lib/navigation-state'
import { trpc } from '../../../trpc'

export function AddInvestmentPage(): JSX.Element {
  const [displayName, setDisplayName] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [added, setAdded] = useState<{ id: string; valueCents: string } | null>(null)
  const create = trpc.portalProve.investments.create.useMutation()
  const utils = trpc.useUtils()
  const location = useLocation()
  const returnState = parseNavigationState(location.state)
  async function save(fields: ValuationFields): Promise<void> {
    if (!displayName.trim()) {
      toast.error('Enter an account name')
      return
    }
    setIsSaving(true)
    try {
      const id = await afterAtLeastASecond(create.mutateAsync({ ...fields, displayName: displayName.trim() }))
      await utils.portalProve.investments.invalidate()
      setAdded({ id, valueCents: fields.valueCents })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add investment account')
    } finally {
      setIsSaving(false)
    }
  }
  if (isSaving) {
    return <InvestmentsAdding />
  }
  if (added) {
    return <InvestmentsAdded account={added} />
  }
  return (
    <Box py={6}>
      <TopBar mb={6}>
        <TopBar.Item as={Link} to="/accounts/verify/manual-type" state={returnState}>
          Back
        </TopBar.Item>
      </TopBar>
      <Stack maxW="480px" mx="auto" spacing={6}>
        <PageHeading
          title="Add Bitcoin-linked Investment"
          description="Track Bitcoin treasury stocks, preferred shares, and other Bitcoin funds or investments by entering their total value in USD."
        />
        <ValuationForm onSave={save} saving={create.isLoading} disabled={displayName.trim() === ''} label="Add Account">
          <FormControl isRequired isDisabled={create.isLoading}>
            <FormLabel htmlFor="investment-name" textStyle="text/sm" color="neutral.600" fontWeight="medium">
              Investment Name
            </FormLabel>
            <Input
              id="investment-name"
              maxLength={200}
              placeholder="e.g. Treasury stocks"
              value={displayName}
              onChange={(event) => {
                setDisplayName(event.target.value)
              }}
            />
          </FormControl>
        </ValuationForm>
      </Stack>
    </Box>
  )
}
