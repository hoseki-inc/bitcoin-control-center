import { Box, Button, Divider, Heading, Input, Stack, Text, VStack } from '@chakra-ui/react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useLocalSetting } from '../../hooks/use-local-settings'
import { isDesktop } from '../../mode'
import { ElectrumSettings } from './electrum-settings'

export function SettingsPage(): JSX.Element {
  const { data: savedName, isLoading, save, isSaving } = useLocalSetting('user_name')

  const [name, setName] = useState('')
  const [isDirty, setIsDirty] = useState(false)

  useEffect(() => {
    if (savedName && !isDirty) {
      setName(savedName)
    }
  }, [savedName, isDirty])

  const handleSave = (): void => {
    save(name.trim())
    setIsDirty(false)
    toast.success('Name saved')
  }

  return (
    <Box p={6}>
      <VStack align="start" gap={8}>
        <VStack align="start" gap={1}>
          <Heading size="lg">Settings</Heading>
          <Text textStyle="text/md" color="neutral.600">
            App preferences and personal information.
          </Text>
        </VStack>

        <Stack gap={2} w="full" maxW="400px">
          <Text textStyle="label/sm" fontWeight="medium">
            Your Name
          </Text>
          <Text textStyle="text/sm" color="neutral.600">
            This name will appear on your generated statements.
          </Text>
          <Input
            placeholder="Enter your name"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setIsDirty(true)
            }}
            isDisabled={isLoading}
          />
          <Button
            size="sm"
            colorScheme="green"
            alignSelf="flex-start"
            onClick={handleSave}
            isLoading={isSaving}
            isDisabled={!isDirty || name.trim() === (savedName ?? '')}
          >
            Save
          </Button>
        </Stack>

        {isDesktop && (
          <>
            <Divider />
            <ElectrumSettings />
          </>
        )}
      </VStack>
    </Box>
  )
}
