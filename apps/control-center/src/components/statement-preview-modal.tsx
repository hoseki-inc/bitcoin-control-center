import {
  Box,
  Button,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Spinner,
  Stack,
  Text,
} from '@chakra-ui/react'
import { renderStatementDocument } from '@hoseki/packages/pdf'
import type { ClaimId } from '@hoseki/packages/schemas'
import { Animations, ErrorBanner } from '@hoseki/packages/ui/design-system'
import { PDFViewer } from '@react-pdf/renderer'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { trpc } from '../trpc'
import type { GenerateStatementPreviewInput } from '../trpc/server-types'

interface BaseStatementPreviewModalProps {
  isOpen: boolean
  onClose: () => void
  claimIds: ClaimId[]
  exchangeAccountIds?: string[]
  title?: string
  description?: string
  showActionButton?: boolean
  actionButtonText?: string
  onActionClick?: () => void
}

interface SelfGeneratedStatementPreviewModalProps extends BaseStatementPreviewModalProps {
  context: 'self_generated'
  openingDate: Date
  closingDate: Date
  timezone: string
  name?: string | null
  address?: string | null
}

type StatementPreviewModalProps = SelfGeneratedStatementPreviewModalProps

export function StatementPreviewModal(props: StatementPreviewModalProps): JSX.Element | null {
  const {
    isOpen,
    onClose,
    claimIds,
    context,
    title = 'Statement Preview',
    description = 'This is a read-only preview of your statement. Verify all details before generating the final statement.',
    showActionButton = false,
    actionButtonText = 'Complete',
    onActionClick,
  } = props

  const exchangeAccountIds = props.exchangeAccountIds ?? []
  const [pdfDocument, setPdfDocument] = useState<React.ReactElement | null>(null)

  const enabled = Boolean(isOpen && (claimIds.length > 0 || exchangeAccountIds.length > 0))

  const input: GenerateStatementPreviewInput = {
    claimIds,
    exchangeAccountIds,
    openingDate: props.openingDate,
    closingDate: props.closingDate,
    timezone: props.timezone,
    name: props.name ?? null,
    address: props.address ?? null,
    format: 'custom',
    context,
  }

  const {
    data: statementData,
    isLoading: isLoadingStatementData,
    isError: isErrorStatementData,
  } = trpc.portalProve.statement.generatePreview.useQuery(input, {
    enabled,
    staleTime: 4 * 60 * 1000, // 4 minutes
    retry(_failureCount, error) {
      return error.data?.code === 'TOO_MANY_REQUESTS'
    },
    retryDelay(_failureCount, error) {
      if (error.data && 'retryAfterSeconds' in error.data) {
        return Number(error.data.retryAfterSeconds) * 1000
      }
      return 10000 // 10 seconds
    },
    onError: (error) => {
      toast.error('Error generating statement preview', {
        description: error.message || 'Failed to generate statement preview',
      })
      // Close the modal when there's an error
      onClose()
    },
  })

  useEffect(() => {
    async function generatePreview() {
      if (!statementData) {
        return
      }

      const document = await renderStatementDocument({
        watermarkText: 'Statement Preview',
        statement: statementData,
      })
      setPdfDocument(document)
    }

    generatePreview()
  }, [statementData])

  if (isErrorStatementData) {
    return null
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="6xl">
      <ModalOverlay />
      <ModalContent width="780px" h="90vh">
        <ModalHeader>{title}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Box width="100%" height="100%" flex={1} display="flex" justifyContent="center" alignItems="center">
            {isLoadingStatementData && <Spinner size="xl" />}
            {isErrorStatementData && <ErrorBanner mb={4} message="Failed to generate statement preview" />}
            {!isLoadingStatementData && pdfDocument && (
              <Stack spacing={4} sx={Animations.fadeIn(0.25)} height="100%" width="100%">
                <Text textStyle="text/sm">{description}</Text>
                <PDFViewer
                  width="100%"
                  height="100%"
                  showToolbar={false}
                  style={{ border: 'none', backgroundColor: 'white' }}
                >
                  {pdfDocument}
                </PDFViewer>
              </Stack>
            )}
          </Box>
        </ModalBody>
        <ModalFooter gap={2} display="flex" justifyContent="space-between">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {showActionButton && (
            <Button onClick={onActionClick} isDisabled={isLoadingStatementData}>
              {actionButtonText}
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
