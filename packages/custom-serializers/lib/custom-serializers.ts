/* eslint-disable @typescript-eslint/no-explicit-any */
import { Err, None, Ok, type Option, type Result, Some, isOption, isResult } from '@patina/core'
import { Decimal } from 'decimal.js'
import type superjson from 'superjson'
import { IndexMap, IndexSet, Mapping } from '../../collection'

/**
 * Decimal Serializer
 */
function registerDecimal(sj: typeof superjson) {
  sj.registerCustom<Decimal, string>(
    {
      isApplicable: (v): v is Decimal => Decimal.isDecimal(v),
      serialize: (v) => v.toJSON(),
      deserialize: (v) => new Decimal(v),
    },
    'Decimal',
  )
}

function registerMapping(sj: typeof superjson) {
  sj.registerCustom<Mapping<{ key: string }>, string[]>(
    {
      isApplicable: (v): v is Mapping<{ key: string }> => v instanceof Mapping,
      serialize: (v) => Array.from(v.values()).map((v) => sj.stringify(v)),
      deserialize: (v) => new Mapping(v.map((v) => sj.parse(v))),
    },
    'Mapping',
  )
}

function registerOption(sj: typeof superjson) {
  sj.registerCustom<Option<unknown>, { variant: 'Some' | 'None'; value: string }>(
    {
      isApplicable: (v): v is Option<unknown> => isOption(v),
      serialize: (v) => ({
        variant: v.isSome() ? 'Some' : 'None',
        value: sj.stringify(v.value()),
      }),
      deserialize: (v) => {
        const parsed = sj.parse(v.value)
        return v.variant === 'Some' ? Some(parsed) : None
      },
    },
    'Option',
  )
}

function registerResult(sj: typeof superjson) {
  sj.registerCustom<Result<unknown, unknown>, { variant: 'Ok' | 'Err'; value: string }>(
    {
      isApplicable: (v): v is Result<unknown, unknown> => isResult(v),
      serialize: (v) => {
        const ok = v.isOk()
        const serialized = {
          variant: ok ? 'Ok' : 'Err',
          value: sj.stringify(ok ? v.value() : v.error()),
        } as const
        return serialized
      },
      deserialize: (v) => {
        const parsed = sj.parse(v.value)
        const deserialized = v.variant === 'Ok' ? Ok(parsed) : Err(parsed)
        return deserialized
      },
    },
    'Result',
  )
}

function registerIndexMap(sj: typeof superjson) {
  sj.registerCustom<IndexMap<any, unknown>, string[]>(
    {
      isApplicable: (v): v is IndexMap<any, unknown> => v instanceof IndexMap,
      serialize: (v) => Array.from(v.entries()).map(([k, v]) => sj.stringify([k, v])),
      deserialize: (v) => new IndexMap(v.map((v) => sj.parse(v))),
    },
    'IndexMap',
  )
}

function registerIndexSet(sj: typeof superjson) {
  sj.registerCustom<IndexSet<any>, string[]>(
    {
      isApplicable: (v): v is IndexSet<any> => v instanceof IndexSet,
      serialize: (v) => Array.from(v.values()).map((v) => sj.stringify(v)),
      deserialize: (v) => new IndexSet(v.map((v) => sj.parse(v))),
    },
    'IndexSet',
  )
}

export function registerCustomSerializers(sj: typeof superjson): typeof superjson {
  registerDecimal(sj)
  registerMapping(sj)
  registerOption(sj)
  registerResult(sj)
  registerIndexMap(sj)
  registerIndexSet(sj)
  return sj
}
