export interface AccessToken {
  variant: 'AccessToken'
  accessToken: string
}

export interface ApiKey {
  variant: 'ApiKey'
  key: string
  secret: string
}

export interface CdpKey {
  variant: 'CdpKey'
  name: string
  secret: string
}

export type Credentials = ApiKey | AccessToken | CdpKey
