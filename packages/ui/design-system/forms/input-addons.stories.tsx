import { FormControl, FormLabel, Input, InputGroup, Stack, Textarea } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import { useState } from 'react'
import { CopyButtonAddon, EditButtonAddon } from './input-addons'

export default {
  title: 'Design system / Forms / Input Addons',
} satisfies StoryDefault

export const CopyButton: Story = () => {
  return (
    <Stack gap={4} maxW="500px">
      <FormControl>
        <FormLabel htmlFor="copy-input">Input with Copy Button</FormLabel>
        <InputGroup>
          <Input id="copy-input" value="This is a value that can be copied" pr={0} isReadOnly />
          <CopyButtonAddon fieldName="value" value="This is a value that can be copied" />
        </InputGroup>
      </FormControl>

      <FormControl>
        <FormLabel htmlFor="copy-textarea">
          Textarea (Note: InputGroup typically works with Input, not Textarea)
        </FormLabel>
        <Textarea
          id="copy-textarea"
          value="This is a longer text value that can be copied from a textarea"
          isReadOnly
        />
      </FormControl>
    </Stack>
  )
}

export const EditButton: Story = () => {
  const [isEditing, setIsEditing] = useState(false)
  const [value, setValue] = useState('This is an editable value')

  return (
    <Stack gap={4} maxW="500px">
      <FormControl>
        <FormLabel htmlFor="edit-input">Input with Edit Button</FormLabel>
        <InputGroup>
          <Input
            id="edit-input"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
            }}
            pr={0}
            isReadOnly={!isEditing}
          />
          <EditButtonAddon
            onClick={() => {
              setIsEditing(!isEditing)
            }}
          />
        </InputGroup>
      </FormControl>
      <div>
        <strong>Editing:</strong> {isEditing ? 'Yes' : 'No'}
      </div>
    </Stack>
  )
}

export const Combined: Story = () => {
  const [address, _setAddress] = useState('bc1qae3yup8ulj732scv3y3k2lr58kuqe7mxhnena8')
  const [message, _setMessage] = useState('This is a test message that needs to be signed.')

  return (
    <Stack gap={4} maxW="500px">
      <FormControl>
        <FormLabel htmlFor="address-input">Address (Copy Only)</FormLabel>
        <InputGroup>
          <Input id="address-input" value={address} pr={0} isReadOnly />
          <CopyButtonAddon fieldName="address" value={address} />
        </InputGroup>
      </FormControl>

      <FormControl>
        <FormLabel htmlFor="message-input">Message (Copy Only)</FormLabel>
        <InputGroup>
          <Input id="message-input" value={message} pr={0} isReadOnly />
          <CopyButtonAddon fieldName="message" value={message} />
        </InputGroup>
      </FormControl>
    </Stack>
  )
}
