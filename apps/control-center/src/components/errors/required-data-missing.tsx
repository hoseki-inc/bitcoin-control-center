import { Button } from '@chakra-ui/react'
import type { ColdcardGenericJsonFile } from '@hoseki/packages/ui/wallet-ui'
import { useEffect } from 'react'
import { browserLogger } from '../../logger'
import { GenericError } from './generic-error'

type RequiredDataMissingProps = {
  model?: string | null
  connectionMethod?: string | null
  coldcardJson?: ColdcardGenericJsonFile | null
}

export function RequiredDataMissing(props: RequiredDataMissingProps): JSX.Element {
  useEffect(() => {
    browserLogger.error(props, 'Required data missing. Dependencies:')
  }, [props])

  return (
    <GenericError
      title="Something went wrong"
      message="We are missing some required data to continue. You'll need to start process again."
    >
      <Button
        variant="outline"
        onClick={() => {
          window.location.reload()
        }}
      >
        Start over
      </Button>
    </GenericError>
  )
}
