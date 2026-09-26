import {
  Box,
  Button,
  HStack,
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
import { Spinner } from '@hoseki/packages/ui/design-system/spinner'
import { Check } from 'lucide-react'
import type { ReactNode } from 'react'

export type TransitionContent = {
  pendingContent: JSX.Element
  completedContent: JSX.Element
  failedContent: JSX.Element
}

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
        <ModalHeader pr={12}>
          <HStack spacing={3}>
            {status !== 'failed' && (
              <Box
                display="flex"
                alignItems="center"
                justifyContent="center"
                boxSize="32px"
                flexShrink={0}
                borderRadius="full"
                bg={status === 'completed' ? 'success.600' : 'neutral.50'}
                color={status === 'completed' ? 'shades.0' : 'neutral.600'}
                aria-hidden="true"
              >
                {status === 'completed' ? <Check size={20} strokeWidth={3} /> : <Spinner size="sm" />}
              </Box>
            )}
            <Box as="span">
              {status === 'pending'
                ? 'Preparing statement'
                : status === 'completed'
                  ? 'Statement ready'
                  : 'Statement not created'}
            </Box>
          </HStack>
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
        <ModalFooter justifyContent="flex-end" flexWrap="wrap" gap={3}>
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

export function getContent(): TransitionContent {
  return {
    pendingContent: (
      <Text textStyle="text/md" color="neutral.600">
        Your statement will appear in Statements when it’s ready. You can continue using Control Center.
      </Text>
    ),
    completedContent: (
      <Text textStyle="text/md" color="neutral.600">
        Your statement is ready to view and download.
      </Text>
    ),
    failedContent: (
      <Text textStyle="text/md" color="neutral.600">
        Your statement could not be created. Close this dialog to review your selection and try again.
      </Text>
    ),
  }
}
