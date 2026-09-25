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
  public response: Response

  public constructor(response: Response) {
    super(response)
    this.response = response
  }

  public get headers(): Headers {
    return this.response.headers
  }

  public get ok(): boolean {
    return this.response.ok
  }

  public get redirected(): boolean {
    return this.response.redirected
  }

  public get status(): number {
    return this.response.status
  }

  public get statusText(): string {
    return this.response.statusText
  }

  public get type(): ResponseType {
    return this.response.type
  }

  public get url(): string {
    return this.response.url
  }

  public clone(): SafeResponse {
    return new SafeResponse(this.response.clone())
  }

  public toJSON(): SafeResponseJSON {
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
