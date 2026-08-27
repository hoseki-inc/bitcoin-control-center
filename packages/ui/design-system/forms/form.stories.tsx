import { Box, FormControl, FormLabel, Input, Select, Stack, Textarea } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import { Button } from '../button'
import { FormErrorMessage } from './form-error-message'
import { RadioCardGroup } from './radio-card'

export default {
  title: 'Design system / Forms',
} satisfies StoryDefault

export const FullForm: Story = () => {
  return (
    <form>
      <Stack gap={4} maxW="700px">
        <Box>
          <p>All the labels:</p>
          <Box>
            <FormLabel>Default, no props</FormLabel>
          </Box>
          <Box>
            <FormLabel size="xs">size xs</FormLabel>
            <br />
            <FormLabel size="sm">size sm</FormLabel>
            <br />
            <FormLabel size="md">size md</FormLabel>
            <br />
            <FormLabel size="lg">size lg</FormLabel>
          </Box>
          <Box>
            <FormLabel textStyle="text/lg">Override with textStyle="text/lg"</FormLabel>
          </Box>
          <FormLabel textStyle="text/lg" color="red" mb={8} display="block" fontSize="18px">
            Override all the default props
          </FormLabel>
        </Box>

        <FormControl>
          <FormLabel htmlFor="input1">An input with placeholder</FormLabel>
          <Input id="input1" placeholder="Placeholder" />
        </FormControl>

        <FormControl>
          <FormLabel htmlFor="input2">An input with a value</FormLabel>
          <Input id="input2" defaultValue="This is the value" />
        </FormControl>

        <FormControl>
          <FormLabel htmlFor="input3">A disabled input</FormLabel>
          <Input id="input3" defaultValue="The value" isDisabled />
        </FormControl>

        <FormControl isInvalid={true}>
          <FormLabel htmlFor="input4">An invalid field</FormLabel>
          <Input id="input4" defaultValue="Something invalid" />
          <FormErrorMessage>Form error message</FormErrorMessage>
        </FormControl>

        <FormControl>
          <FormLabel htmlFor="textarea1">A textarea</FormLabel>
          <Textarea id="textarea1" placeholder="Placeholder" rows={3} />
        </FormControl>

        <FormControl>
          <FormLabel htmlFor="textarea2">A textarea with a value</FormLabel>
          <Textarea id="textarea2" defaultValue="This is the value" rows={3} />
        </FormControl>

        <FormControl>
          <FormLabel htmlFor="textarea3">A disabled textarea</FormLabel>
          <Textarea id="textarea3" rows={3} defaultValue="This is the value" isDisabled />
        </FormControl>

        <FormControl isInvalid={true}>
          <FormLabel htmlFor="textarea4">An invalid textarea</FormLabel>
          <Textarea id="textarea4" rows={3} defaultValue="Something invalid here" />
          <FormErrorMessage>Form error message</FormErrorMessage>
        </FormControl>

        <FormControl>
          <FormLabel>A textarea</FormLabel>

          <Select id="scriptTypeSelect" defaultValue={scriptTypes[1]} required>
            {scriptTypes.map((scriptType) => (
              <option key={scriptType} value={scriptType}>
                {scriptType}
              </option>
            ))}
          </Select>
        </FormControl>

        <FormControl>
          <FormLabel>A RadioCardGroup</FormLabel>
          <RadioCardGroup
            options={scriptTypes}
            name="scriptTypeRadioCards"
            defaultValue={scriptTypes[0]}
            onChange={console.log}
          />
        </FormControl>

        <Box mt={4}>
          <Button type="submit">Submit</Button>
        </Box>
      </Stack>
    </form>
  )
}

const scriptTypes = ['Legacy (P2PKH)', 'Nested SegWit (P2SH)', 'Native SegWit (P2WPKH)', 'Taproot (P2TR)']
