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
} {
  const queryClient = useQueryClient()
  const queryKey = ['local-settings', key]

  const query = useQuery({
    queryKey,
    queryFn: () => baseTrpc.settings.get.query({ key }),
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
    onSuccess: () => {
      return queryClient.invalidateQueries({ queryKey })
    },
  })

  return {
    data: query.data,
    isLoading: query.isLoading,
    save: (value: string) => {
      mutation.mutate(value)
    },
    isSaving: mutation.isLoading,
  }
}
