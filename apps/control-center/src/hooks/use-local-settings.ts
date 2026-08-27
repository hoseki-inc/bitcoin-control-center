import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import superjson from 'superjson'

const baseUrl = import.meta.env['VITE_BACKEND_API_URL'] ?? ''

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
    queryFn: async (): Promise<string | null> => {
      const input = superjson.serialize({ key })
      const params = new URLSearchParams({ input: JSON.stringify(input) })
      const res = await fetch(`${baseUrl}/settings.get?${params}`)
      if (!res.ok) throw new Error('Failed to fetch setting')
      const json = await res.json()
      return superjson.deserialize(json.result.data) as string | null
    },
  })

  const mutation = useMutation({
    mutationFn: async (value: string): Promise<void> => {
      const res = await fetch(`${baseUrl}/settings.update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(superjson.serialize({ key, value })),
      })
      if (!res.ok) throw new Error('Failed to save setting')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
    },
  })

  return {
    data: query.data,
    isLoading: query.isLoading,
    save: (value: string) => mutation.mutate(value),
    isSaving: mutation.isLoading,
  }
}
