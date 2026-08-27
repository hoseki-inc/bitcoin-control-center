export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'HEAD' | 'DELETE'

export type Input = RequestInfo | URL

export interface Options extends RequestInit {
  method?: Method
}
