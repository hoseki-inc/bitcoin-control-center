import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import superjson from 'superjson'
import { baseTrpc } from '../trpc'

const baseUrl = import.meta.env.VITE_BACKEND_API_URL ?? ''

/**
 * Hook for reading/writing local settings stored in api-sentinel's SQLite.
 */
export function useLocalSetting(key: string): {
  data: string | null | undefined
  isLoading: boolean
  save: (value: string) => void
  isSaving: boolean
  isError: boolean
  saveAsync: (value: string) => Promise<void>
} {
  const queryClient = useQueryClient()
  const queryKey = ['local-settings', key]

  const query = useQuery({
    queryKey,
    staleTime: 30_000,
    queryFn: async () => baseTrpc.settings.get.query({ key }),
  })

  const mutation = useMutation({
    mutationFn: async (value: string): Promise<void> => {
      const res = await fetch(`${baseUrl}/settings.update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(superjson.serialize({ key, value })),
      })
      if (!res.ok) {
        throw new Error('Failed to save setting')
      }
    },
    onSuccess: (_data, value) => {
      queryClient.setQueryData(queryKey, value)
    },
  })

  return {
    data: query.data,
    isLoading: query.isLoading,
    save: (value: string) => {
      mutation.mutate(value)
    },
    isSaving: mutation.isLoading,
    isError: query.isError,
    saveAsync: mutation.mutateAsync,
  }
}
