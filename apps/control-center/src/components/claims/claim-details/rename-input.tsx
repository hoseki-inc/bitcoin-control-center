import { Box, Button, FormControl, FormErrorMessage, FormLabel, HStack, Input, Stack, chakra } from '@chakra-ui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
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
    setFocus,
    formState: { errors, isSubmitting, isValid },
  } = useForm<RenameForm>({
    defaultValues: {
      name: defaultName,
    },
    mode: 'onChange',
    reValidateMode: 'onChange',
    resolver: zodResolver(schema),
  })

  // Renaming starts with the field ready to type into.
  useEffect(() => {
    setFocus('name')
  }, [setFocus])

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
      <Stack direction={{ base: 'column', sm: 'row' }} spacing={3} align="end">
        <Box flexGrow={1} minW={0} w="full">
          <FormControl isInvalid={Boolean(errors.name)}>
            <FormLabel htmlFor={inputId}>Name</FormLabel>
            <Input id={inputId} {...register('name')} width="100%" placeholder={placeholderName} />
            <FormErrorMessage>{errors.name?.message}</FormErrorMessage>
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
      </Stack>
    </chakra.form>
  )
}
