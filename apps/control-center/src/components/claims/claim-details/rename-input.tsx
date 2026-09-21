import { Box, Button, FormControl, FormLabel, HStack, Input, chakra } from '@chakra-ui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

const schema = z.object({
  name: z.string().min(1, 'Name can not be empty').max(255, 'Name exceeds limit of 255 characters'),
})

type RenameForm = z.infer<typeof schema>

export function RenameInput({
  inputId,
  defaultName,
  placeholderName,
  isLoading,
  onSaveClick,
  onCancel,
}: {
  inputId: string
  defaultName: string
  placeholderName: string
  isLoading: boolean
  onSaveClick: (updatedName: string) => void
  onCancel: () => void
}): JSX.Element {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isValid },
  } = useForm<RenameForm>({
    defaultValues: {
      name: defaultName,
    },
    mode: 'onChange',
    reValidateMode: 'onChange',
    resolver: zodResolver(schema),
  })

  function onSubmit(data: { name: string }) {
    onSaveClick(data.name)
  }

  return (
    <chakra.form
      onSubmit={(event) => {
        handleSubmit(onSubmit)(event).catch(() => {
          toast.error('Unable to save the name. Please try again.')
        })
      }}
    >
      <HStack spacing={8}>
        <Box flexGrow={1}>
          <FormControl isInvalid={Boolean(errors.name)}>
            <FormLabel htmlFor={inputId}>Name</FormLabel>
            <Input {...register('name')} width="100%" placeholder={placeholderName} />
          </FormControl>
        </Box>
        <HStack alignSelf="flex-end">
          <Button type="submit" variant="outline" isDisabled={!isValid || isSubmitting} isLoading={isLoading}>
            Save
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </HStack>
      </HStack>
    </chakra.form>
  )
}
