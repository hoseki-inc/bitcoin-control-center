export type JsonRecord = Record<string, string | number | boolean | undefined | null>

export function recordToSearchParams(record: JsonRecord): URLSearchParams {
  const searchParams = new URLSearchParams()
  Object.entries(record).forEach(([key, value]) => {
    if (value != null && Boolean(value)) {
      searchParams.set(key, value.toString())
    }
  })
  return searchParams
}

export function recordToFormData(record: JsonRecord): FormData {
  const formData = new FormData()
  Object.entries(record).forEach(([key, value]) => {
    if (value != null && Boolean(value)) {
      formData.set(key, value.toString())
    }
  })
  return formData
}

export function recordToHeaders(record: JsonRecord): Headers {
  const headers = new Headers()
  Object.entries(record).forEach(([key, value]) => {
    if (value != null && Boolean(value)) {
      headers.set(key, value.toString())
    }
  })
  return headers
}
