import { SafeBody } from './body.ts'

export class SafeRequest extends SafeBody {
  constructor(public request: Request) {
    super(request)
  }

  get cache(): RequestCache {
    return this.request.cache
  }

  get credentials(): RequestCredentials {
    return this.request.credentials
  }

  get destination(): RequestDestination {
    return this.request.destination
  }

  get headers(): Headers {
    return this.request.headers
  }

  get integrity(): string {
    return this.request.integrity
  }

  get keepalive(): boolean {
    return this.request.keepalive
  }

  get method(): string {
    return this.request.method
  }

  get mode(): RequestMode {
    return this.request.mode
  }

  get redirect(): RequestRedirect {
    return this.request.redirect
  }

  get referrer(): string {
    return this.request.referrer
  }

  get referrerPolicy(): ReferrerPolicy {
    return this.request.referrerPolicy
  }

  get url(): string {
    return this.request.url
  }

  clone(): SafeRequest {
    return new SafeRequest(this.request.clone())
  }
}
