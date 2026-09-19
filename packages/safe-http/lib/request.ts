import { SafeBody } from './body.ts'

export class SafeRequest extends SafeBody {
  public constructor(public request: Request) {
    super(request)
  }

  public get cache(): RequestCache {
    return this.request.cache
  }

  public get credentials(): RequestCredentials {
    return this.request.credentials
  }

  public get destination(): RequestDestination {
    return this.request.destination
  }

  public get headers(): Headers {
    return this.request.headers
  }

  public get integrity(): string {
    return this.request.integrity
  }

  public get keepalive(): boolean {
    return this.request.keepalive
  }

  public get method(): string {
    return this.request.method
  }

  public get mode(): RequestMode {
    return this.request.mode
  }

  public get redirect(): RequestRedirect {
    return this.request.redirect
  }

  public get referrer(): string {
    return this.request.referrer
  }

  public get referrerPolicy(): ReferrerPolicy {
    return this.request.referrerPolicy
  }

  public get url(): string {
    return this.request.url
  }

  public clone(): SafeRequest {
    return new SafeRequest(this.request.clone())
  }
}
