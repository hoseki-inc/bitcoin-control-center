import {
  Accordion,
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  Box,
  Stack,
  Text,
  VStack,
} from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'

export default {
  title: 'Design system / Theme / Accordion',
} satisfies StoryDefault

export const SingleItem: Story = () => {
  return (
    <Box maxW="600px">
      <Accordion>
        <AccordionItem>
          <AccordionButton>
            <Box flex="1" textAlign="left">
              <Text fontWeight="medium">What is Bitcoin Control Center?</Text>
            </Box>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel pb={4}>
            <Text>
              Bitcoin Control Center enables users to prove ownership of their Bitcoin and track their portfolio through
              a secure verification process.
            </Text>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </Box>
  )
}

export const MultipleItems: Story = () => {
  return (
    <Box maxW="600px">
      <Accordion>
        <AccordionItem>
          <AccordionButton>
            <Box flex="1" textAlign="left">
              <Text fontWeight="medium">What is Bitcoin Control Center?</Text>
            </Box>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel pb={4}>
            <Text>
              Bitcoin Control Center enables users to prove ownership of their Bitcoin and track their portfolio through
              a secure verification process.
            </Text>
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem>
          <AccordionButton>
            <Box flex="1" textAlign="left">
              <Text fontWeight="medium">How does verification work?</Text>
            </Box>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel pb={4}>
            <Text>
              Verification involves signing a message with your private key to prove ownership of your Bitcoin address
              or wallet.
            </Text>
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem>
          <AccordionButton>
            <Box flex="1" textAlign="left">
              <Text fontWeight="medium">Is my data secure?</Text>
            </Box>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel pb={4}>
            <Text>
              Yes, we use industry-standard security practices and never store your private keys. All verification is
              done client-side.
            </Text>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </Box>
  )
}

export const AllowMultiple: Story = () => {
  return (
    <Box maxW="600px">
      <Accordion allowMultiple>
        <AccordionItem>
          <AccordionButton>
            <Box flex="1" textAlign="left">
              <Text fontWeight="medium">First Item</Text>
            </Box>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel pb={4}>
            <Text>This is the first accordion item. Multiple items can be open at the same time.</Text>
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem>
          <AccordionButton>
            <Box flex="1" textAlign="left">
              <Text fontWeight="medium">Second Item</Text>
            </Box>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel pb={4}>
            <Text>This is the second accordion item. You can open both items simultaneously.</Text>
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem>
          <AccordionButton>
            <Box flex="1" textAlign="left">
              <Text fontWeight="medium">Third Item</Text>
            </Box>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel pb={4}>
            <Text>This is the third accordion item. All three can be open at once.</Text>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </Box>
  )
}

export const AllowToggle: Story = () => {
  return (
    <Box maxW="600px">
      <Accordion allowToggle>
        <AccordionItem>
          <AccordionButton>
            <Box flex="1" textAlign="left">
              <Text fontWeight="medium">Toggle Item 1</Text>
            </Box>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel pb={4}>
            <Text>With allowToggle, you can close an item by clicking it again when it's open.</Text>
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem>
          <AccordionButton>
            <Box flex="1" textAlign="left">
              <Text fontWeight="medium">Toggle Item 2</Text>
            </Box>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel pb={4}>
            <Text>Only one item can be open at a time, but you can toggle it closed.</Text>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </Box>
  )
}

export const WithRichContent: Story = () => {
  return (
    <Box maxW="600px">
      <Accordion>
        <AccordionItem>
          <AccordionButton>
            <Box flex="1" textAlign="left">
              <Text fontWeight="medium">Account Information</Text>
            </Box>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel pb={4}>
            <VStack align="stretch" spacing={3}>
              <Box>
                <Text fontWeight="medium" mb={1}>
                  Account Name
                </Text>
                <Text color="neutral.600">My Bitcoin Wallet</Text>
              </Box>
              <Box>
                <Text fontWeight="medium" mb={1}>
                  Balance
                </Text>
                <Text color="neutral.600">0.5 BTC ($25,000)</Text>
              </Box>
              <Box>
                <Text fontWeight="medium" mb={1}>
                  Address Type
                </Text>
                <Text color="neutral.600">Native SegWit (P2WPKH)</Text>
              </Box>
            </VStack>
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem>
          <AccordionButton>
            <Box flex="1" textAlign="left">
              <Text fontWeight="medium">Transaction History</Text>
            </Box>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel pb={4}>
            <Stack spacing={2}>
              <Box p={3} bgColor="neutral.50" borderRadius="md">
                <Text fontWeight="medium" fontSize="sm">
                  Received 0.1 BTC
                </Text>
                <Text fontSize="xs" color="neutral.600">
                  2 days ago
                </Text>
              </Box>
              <Box p={3} bgColor="neutral.50" borderRadius="md">
                <Text fontWeight="medium" fontSize="sm">
                  Sent 0.05 BTC
                </Text>
                <Text fontSize="xs" color="neutral.600">
                  1 week ago
                </Text>
              </Box>
            </Stack>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </Box>
  )
}

export const WithBorders: Story = () => {
  return (
    <Box maxW="600px">
      <Accordion border="solid 1px" borderColor="neutral.200" borderRadius="4px">
        <AccordionItem border="none">
          <AccordionButton>
            <Box flex="1" textAlign="left">
              <Text fontWeight="medium">Bordered Accordion Item 1</Text>
            </Box>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel pb={4}>
            <Text>This accordion has a border around the entire component.</Text>
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem border="none" borderTop="solid 1px" borderColor="neutral.200">
          <AccordionButton>
            <Box flex="1" textAlign="left">
              <Text fontWeight="medium">Bordered Accordion Item 2</Text>
            </Box>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel pb={4}>
            <Text>Items are separated by borders.</Text>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </Box>
  )
}

export const DefaultIndex: Story = () => {
  return (
    <Box maxW="600px">
      <Accordion defaultIndex={[0]}>
        <AccordionItem>
          <AccordionButton>
            <Box flex="1" textAlign="left">
              <Text fontWeight="medium">Pre-opened Item</Text>
            </Box>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel pb={4}>
            <Text>This item is open by default.</Text>
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem>
          <AccordionButton>
            <Box flex="1" textAlign="left">
              <Text fontWeight="medium">Closed Item</Text>
            </Box>
            <AccordionIcon />
          </AccordionButton>
          <AccordionPanel pb={4}>
            <Text>This item is closed by default.</Text>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </Box>
  )
}
