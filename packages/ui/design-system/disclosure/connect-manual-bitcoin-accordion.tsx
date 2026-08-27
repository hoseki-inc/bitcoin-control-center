import {
  Accordion,
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  Button,
  HStack,
  Text,
} from '@chakra-ui/react'
import { Link, type To } from 'react-router'
import { Badge } from '..'

export function ConnectManualBitcoinAccordion({ to, state }: { to: To; state?: Record<string, unknown> }): JSX.Element {
  return (
    <Accordion allowMultiple border="solid 1px" borderColor="neutral.200" borderRadius="4px">
      <AccordionItem border="none">
        <h2>
          <AccordionButton p={4} _hover={{ bgColor: 'inherit' }}>
            <HStack flex="1" textAlign="left">
              <Badge>Advanced</Badge>
              <Text as="h3" textStyle="text/sm" color="neutral.600" fontWeight={500}>
                Manually Verify Your Self-Custodial Bitcoin Holdings
              </Text>
            </HStack>
            <AccordionIcon />
          </AccordionButton>
        </h2>
        <AccordionPanel p={4} pt={0} display="flex" flexDirection="column" gap={4} textAlign="left">
          <Text textStyle="text/sm" color="neutral.600">
            You can manually sign a message to verify your bitcoin holdings. This is recommended for users comfortable
            with Bitcoin message signing tools.
          </Text>
          <Button as={Link} to={to} state={state} variant="outline" size="sm" width="fit-content">
            Verify with Manual Signing
          </Button>
        </AccordionPanel>
      </AccordionItem>
    </Accordion>
  )
}
