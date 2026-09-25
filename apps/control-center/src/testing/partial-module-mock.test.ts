import type { PartialModuleMock } from '@hoseki/packages/testing/partial-module-mock'
import { expectTypeOf, it } from 'vitest'

type Api = {
  client: {
    name: string
    query: (id: string | number) => { value: number; label: string }
  }
  Device: new (id: string) => { connected: boolean; close: () => void }
  notify: ((message: string) => number) & { dismiss: () => void }
  items: Array<{ id: string; label: string }>
}

it('accepts real APIs and intentionally partial test fixtures', () => {
  expectTypeOf<Api>().toExtend<PartialModuleMock<Api>>()
  expectTypeOf<{
    client: { query: (id: string) => { value: number } }
    Device: new (id: string) => { connected: boolean }
    notify: (message: string) => number
    items: Array<{ id: string }>
  }>().toExtend<PartialModuleMock<Api>>()
})

it('rejects incompatible supplied properties, results, arguments, and instances', () => {
  expectTypeOf<{ client: { name: number } }>().not.toExtend<PartialModuleMock<Api>>()
  expectTypeOf<{ client: { query: (id: string) => { value: string } } }>().not.toExtend<PartialModuleMock<Api>>()
  expectTypeOf<{ client: { query: (id: boolean) => { value: number } } }>().not.toExtend<PartialModuleMock<Api>>()
  expectTypeOf<{ Device: new (id: string) => { connected: string } }>().not.toExtend<PartialModuleMock<Api>>()
  expectTypeOf<{ notify: { dismiss: () => void } }>().not.toExtend<PartialModuleMock<Api>>()
  expectTypeOf<{ items: Array<{ id: number }> }>().not.toExtend<PartialModuleMock<Api>>()
})

it('checks asynchronous fixture values', () => {
  type AsyncApi = { fetch: () => Promise<{ id: string; amount: number }> }
  expectTypeOf<AsyncApi>().toExtend<PartialModuleMock<AsyncApi>>()
  expectTypeOf<{ fetch: () => Promise<{ id: string }> }>().toExtend<PartialModuleMock<AsyncApi>>()
  expectTypeOf<{ fetch: () => Promise<{ id: number }> }>().not.toExtend<PartialModuleMock<AsyncApi>>()
})
