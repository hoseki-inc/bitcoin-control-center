import { SafeBody } from './body.ts'

export interface SafeResponseJSON {
  ok: boolean
  headers: Headers
  redirected: boolean
  status: number
  statusText: string
  type: ResponseType
  url: string
}

export class SafeResponse extends SafeBody {
  constructor(public response: Response) {
    super(response)
  }

  get headers(): Headers {
    return this.response.headers
  }

  get ok(): boolean {
    return this.response.ok
  }

  get redirected(): boolean {
    return this.response.redirected
  }

  get status(): number {
    return this.response.status
  }

  get statusText(): string {
    return this.response.statusText
  }

  get type(): ResponseType {
    return this.response.type
  }

  get url(): string {
    return this.response.url
  }

  clone(): SafeResponse {
    return new SafeResponse(this.response.clone())
  }

  toJSON(): SafeResponseJSON {
    return {
      ok: this.ok,
      headers: this.headers,
      redirected: this.redirected,
      status: this.status,
      statusText: this.statusText,
      type: this.type,
      url: this.url,
    }
  }
}
