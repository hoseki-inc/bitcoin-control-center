import {
  Button,
  Flex,
  FormControl,
  FormLabel,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  SimpleGrid,
  Stack,
  Text,
  VStack,
  useDisclosure,
} from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import { useState } from 'react'
import { ErrorBanner, ErrorInline } from './errors'

export default {
  title: 'Design System / Modal',
} satisfies StoryDefault

// Modal sizes from Chakra UI default theme
const modalSizes = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', 'full']

export const Sizes: Story = () => {
  const [activeModal, setActiveModal] = useState<string | null>(null)

  return (
    <VStack spacing={4}>
      <Text textStyle="text/lg" fontWeight="bold">
        Modal Sizes (Chakra Default)
      </Text>
      <SimpleGrid columns={3} spacing={4}>
        {modalSizes.map((size) => (
          <Button key={size} onClick={() => setActiveModal(size)} size="sm">
            {size}
          </Button>
        ))}
      </SimpleGrid>

      {modalSizes.map((size) => (
        <Modal key={size} isOpen={activeModal === size} onClose={() => setActiveModal(null)} isCentered size={size}>
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>
              <Text textStyle="text/lg" color="neutral.900">
                Modal Size: {size}
              </Text>
            </ModalHeader>
            <ModalCloseButton />

            <ModalBody>
              <Text textStyle="text/sm" color="neutral.600" mb={4}>
                This modal demonstrates the {size} size variant using our custom modal theme.
              </Text>
              <Text textStyle="text/sm" color="neutral.600">
                Notice the consistent 24px padding, 16px gaps between sections, and 8px border radius applied through
                our theme configuration.
              </Text>
            </ModalBody>

            <ModalFooter>
              <SimpleGrid columns={2} spacing={3} width="full">
                <Button variant="outline" onClick={() => setActiveModal(null)} size="md">
                  Cancel
                </Button>
                <Button onClick={() => setActiveModal(null)} size="md" colorScheme="blue">
                  Confirm
                </Button>
              </SimpleGrid>
            </ModalFooter>
          </ModalContent>
        </Modal>
      ))}
    </VStack>
  )
}

export const BasicModal: Story = () => {
  const { isOpen, onOpen, onClose } = useDisclosure()

  return (
    <>
      <Button onClick={onOpen}>Open Modal</Button>

      <Modal isOpen={isOpen} onClose={onClose} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            <Text textStyle="text/lg" color="neutral.900">
              Basic Modal
            </Text>
          </ModalHeader>
          <ModalCloseButton />

          <ModalBody>
            <Text textStyle="text/sm" color="neutral.600" mb={4}>
              This is a basic modal using our custom theme with proper spacing and typography.
            </Text>
            <Text textStyle="text/sm" color="neutral.600">
              The theme includes 24px padding on the dialog, 16px gaps between sections, and consistent styling.
            </Text>
          </ModalBody>

          <ModalFooter>
            <SimpleGrid columns={2} spacing={3} width="full">
              <Button variant="outline" onClick={onClose} size="md">
                Cancel
              </Button>
              <Button onClick={onClose} size="md" colorScheme="blue">
                Save Changes
              </Button>
            </SimpleGrid>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}

export const NoPaddingVariant: Story = () => {
  const { isOpen, onOpen, onClose } = useDisclosure()

  const containerProps = {
    p: 8,
    flexDirection: 'column',
    justifyContent: 'space-between',
    flexBasis: '50%',
  } as const

  return (
    <>
      <Button onClick={onOpen}>Open variant="noPadding"</Button>

      <Modal isOpen={isOpen} onClose={onClose} isCentered variant="noPadding" size="4xl">
        <ModalOverlay />
        <ModalContent>
          <ModalCloseButton />

          <ModalBody>
            <Flex flexDirection={['column', 'column', 'row']}>
              <Flex
                {...containerProps}
                position="relative"
                color="shades.0"
                textAlign="center"
                bg="linear-gradient(0deg, rgba(0, 0, 0, 0.75) 0%, rgba(0, 0, 0, 0.25) 50%, rgba(0, 0, 0, 0.05) 100%), url(forest.png) no-repeat center/cover"
              />
              <Flex {...containerProps}>
                <Stack gap={16} justifyContent="space-between" spacing={16}>
                  <Stack>
                    <FormControl>
                      <FormLabel htmlFor="input1">An input with placeholder</FormLabel>
                      <Input id="input1" placeholder="Placeholder" />
                    </FormControl>
                    <FormControl>
                      <FormLabel htmlFor="input2">An input with placeholder</FormLabel>
                      <Input id="input2" placeholder="Placeholder" />
                    </FormControl>
                    <FormControl>
                      <FormLabel htmlFor="input3">An input with placeholder</FormLabel>
                      <Input id="input3" placeholder="Placeholder" />
                    </FormControl>
                  </Stack>

                  <Stack minH="300px" alignItems="flex-end" justifyContent="flex-end">
                    <ErrorBanner w="full" message="Error message" />
                    <Button w="full">Submit</Button>
                  </Stack>
                </Stack>
              </Flex>
            </Flex>
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  )
}

export const NewDeviceConnectionExample: Story = () => {
  const { isOpen, onOpen, onClose } = useDisclosure()
  const [isLoading, setIsLoading] = useState(false)

  const handleConnect = () => {
    setIsLoading(true)
    setTimeout(() => {
      setIsLoading(false)
      onClose()
    }, 2000)
  }

  return (
    <>
      <Button onClick={onOpen}>Open New Device Connection Modal</Button>

      <Modal isOpen={isOpen} onClose={onClose} isCentered size="sm">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            <Text textStyle="text/lg" color="neutral.900">
              Start Over With a New Device?
            </Text>
          </ModalHeader>
          <ModalCloseButton isDisabled={isLoading} />

          <ModalBody>
            <Text textStyle="text/sm" color="neutral.600" mb={4}>
              You're about to reconnect your wallet using a new hardware device.
            </Text>
            <Text textStyle="text/sm" color="neutral.600">
              To keep your proof secure, we'll need to start the verification process from scratch and check that this
              device still controls the same key you previously verified
            </Text>
          </ModalBody>

          <ModalFooter>
            <SimpleGrid columns={2} spacing={3} width="full">
              <Button variant="outline" onClick={onClose} isDisabled={isLoading} size="md">
                Cancel
              </Button>
              <Button onClick={handleConnect} isLoading={isLoading} size="md" colorScheme="blue">
                Connect New Device
              </Button>
            </SimpleGrid>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}

export const LoadingStates: Story = () => {
  const [activeModal, setActiveModal] = useState<string | null>(null)
  const [loadingState, setLoadingState] = useState(false)

  const handleAction = () => {
    setLoadingState(true)
    setTimeout(() => {
      setLoadingState(false)
      setActiveModal(null)
    }, 2000)
  }

  return (
    <VStack spacing={4}>
      <Text textStyle="text/lg" fontWeight="bold">
        Modal Loading States
      </Text>
      <SimpleGrid columns={2} spacing={4}>
        <Button onClick={() => setActiveModal('normal')} size="sm">
          Normal State
        </Button>
        <Button onClick={() => setActiveModal('loading')} size="sm">
          Loading State
        </Button>
      </SimpleGrid>

      <Modal isOpen={activeModal === 'normal'} onClose={() => setActiveModal(null)} isCentered size="sm">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            <Text textStyle="text/lg" color="neutral.900">
              Normal State
            </Text>
          </ModalHeader>
          <ModalCloseButton />

          <ModalBody>
            <Text textStyle="text/sm" color="neutral.600">
              This modal shows the normal interactive state with all controls enabled.
            </Text>
          </ModalBody>

          <ModalFooter>
            <SimpleGrid columns={2} spacing={3} width="full">
              <Button variant="outline" onClick={() => setActiveModal(null)} size="md">
                Cancel
              </Button>
              <Button onClick={() => handleAction()} size="md" colorScheme="blue">
                Confirm
              </Button>
            </SimpleGrid>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={activeModal === 'loading'} onClose={() => setActiveModal(null)} isCentered size="sm">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            <Text textStyle="text/lg" color="neutral.900">
              Loading State
            </Text>
          </ModalHeader>
          <ModalCloseButton isDisabled={loadingState} />

          <ModalBody>
            <Text textStyle="text/sm" color="neutral.600">
              This modal demonstrates loading states with disabled controls and loading buttons.
            </Text>
          </ModalBody>

          <ModalFooter>
            <SimpleGrid columns={2} spacing={3} width="full">
              <Button variant="outline" onClick={() => setActiveModal(null)} isDisabled={loadingState} size="md">
                Cancel
              </Button>
              <Button onClick={() => handleAction()} isLoading={loadingState} size="md" colorScheme="blue">
                Processing...
              </Button>
            </SimpleGrid>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </VStack>
  )
}

export const ErrorStates: Story = () => {
  const [activeModal, setActiveModal] = useState<'inline-top' | 'banner-top' | null>(null)

  return (
    <VStack spacing={4}>
      <Text textStyle="text/lg" fontWeight="bold">
        Modal Error States
      </Text>
      <SimpleGrid columns={2} spacing={4}>
        <Button onClick={() => setActiveModal('inline-top')} size="sm">
          With ErrorInline on top
        </Button>
        <Button onClick={() => setActiveModal('banner-top')} size="sm">
          With ErrorBanner on top
        </Button>
      </SimpleGrid>

      <Modal isOpen={activeModal === 'inline-top'} onClose={() => setActiveModal(null)} isCentered size="sm">
        <ModalOverlay />
        <ModalContent>
          <ErrorInline mt={2} title="Something went wrong" message="Contact support if the problem persists" />

          <ModalHeader>
            <Text textStyle="text/lg" color="neutral.900">
              Loading State
            </Text>
          </ModalHeader>

          <ModalCloseButton />

          <ModalBody>
            <Text textStyle="text/sm" color="neutral.600">
              This modal demonstrates the error state.
            </Text>
          </ModalBody>

          <ModalFooter>
            <SimpleGrid columns={2} spacing={3} width="full">
              <Button variant="outline" onClick={() => setActiveModal(null)} size="md">
                Cancel
              </Button>
              <Button size="md" colorScheme="blue">
                Confirm
              </Button>
            </SimpleGrid>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={activeModal === 'banner-top'} onClose={() => setActiveModal(null)} isCentered size="sm">
        <ModalOverlay />
        <ModalContent>
          <ErrorBanner mt={2} title="Something went wrong" message="Contact support if the problem persists" />

          <ModalHeader>
            <Text textStyle="text/lg" color="neutral.900">
              Error State With Banner As First Child
            </Text>
          </ModalHeader>

          <ModalCloseButton />

          <ModalBody>
            <Text textStyle="text/sm" color="neutral.600">
              This modal demonstrates the error state.
            </Text>
          </ModalBody>

          <ModalFooter>
            <SimpleGrid columns={2} spacing={3} width="full">
              <Button variant="outline" onClick={() => setActiveModal(null)} size="md">
                Cancel
              </Button>
              <Button size="md" colorScheme="blue">
                Confirm
              </Button>
            </SimpleGrid>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </VStack>
  )
}
