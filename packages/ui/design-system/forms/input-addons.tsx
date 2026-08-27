import { Button, InputRightAddon } from '@chakra-ui/react'
import { CopyIcon, PencilIcon } from 'lucide-react'
import { toast } from 'sonner'

export function CopyButtonAddon({ fieldName, value }: { fieldName: string; value: string }): JSX.Element {
  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(
      () => {
        toast.success(`The ${fieldName} was copied to the clipboard.`)
      },
      (_err) => {
        toast.error(`Error trying to copy ${fieldName} to the clipboard.`)
      },
    )
  }

  return (
    <InputRightAddon
      border="1px solid"
      borderColor="neutral.50"
      bgColor="neutral.50"
      borderLeftWidth={0}
      borderTopRightRadius={4}
      borderBottomRightRadius={4}
    >
      <Button size="sm" variant="plain" onClick={handleCopy}>
        <CopyIcon size={16} style={{ marginRight: '4px' }} />
      </Button>
    </InputRightAddon>
  )
}

export function EditButtonAddon({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <InputRightAddon
      border="1px solid"
      borderColor="neutral.50"
      bgColor="neutral.50"
      borderLeftWidth={0}
      borderTopRightRadius={4}
      borderBottomRightRadius={4}
    >
      <Button size="sm" variant="plain" onClick={onClick}>
        <PencilIcon size={16} style={{ marginRight: '4px' }} />
      </Button>
    </InputRightAddon>
  )
}
