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
  type ModalProps,
  Stack,
  Text,
} from '@chakra-ui/react'
import { Spinner } from '@hoseki/packages/ui/design-system'
import { CheckCircle2 } from 'lucide-react'
import type { ReactNode } from 'react'

export type FullTransitionModalStatus = 'pending' | 'completed' | 'failed'

type FullTransitionModalProps = {
  content: ReturnType<typeof getContent>
  status: FullTransitionModalStatus
  additionalCompletedContent: ReactNode
} & Omit<ModalProps, 'children'>

export function FullTransitionModal({
  content,
  status,
  additionalCompletedContent,
  ...props
}: FullTransitionModalProps): JSX.Element {
  return (
    <Modal size="lg" isCentered scrollBehavior="inside" {...props}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader pr={8}>
          {status === 'pending'
            ? 'Preparing statement'
            : status === 'completed'
              ? 'Statement ready'
              : 'Statement not created'}
        </ModalHeader>
        <ModalCloseButton aria-label="Close statement status" />
        <ModalBody>
          <Stack gap={5} role={status === 'failed' ? 'alert' : 'status'} aria-live="polite">
            {status === 'pending'
              ? content.pendingContent
              : status === 'completed'
                ? content.completedContent
                : content.failedContent}
          </Stack>
        </ModalBody>
        <ModalFooter justifyContent="flex-start" flexWrap="wrap" gap={3}>
          {status === 'completed' ? (
            additionalCompletedContent
          ) : (
            <Button variant="outline" onClick={props.onClose}>
              {status === 'pending' ? 'Continue in background' : 'Back to statement'}
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export function getContent(): {
  pendingContent: JSX.Element
  completedContent: JSX.Element
  failedContent: JSX.Element
} {
  return {
    pendingContent: (
      <>
        <Text textStyle="text/md" color="neutral.600">
          You can keep using Control Center while your statement is prepared. It will appear in Statements when ready.
        </Text>
        <Box>
          <Spinner height="32px" width="32px" />
        </Box>
      </>
    ),
    completedContent: (
      <>
        <CheckCircle2 size={32} aria-hidden="true" />
        <Text textStyle="text/md" color="neutral.600">
          Your statement is ready to view and download.
        </Text>
      </>
    ),
    failedContent: (
      <Text textStyle="text/md" color="neutral.600">
        Your statement could not be created. Close this dialog to review your selection and try again.
      </Text>
    ),
  }
}
