import { AsyncOption } from './async_option'
import { AsyncResult } from './async_result'
import { type Option, OptionImpl } from './option'
import { type Err, type Ok, type Result, ResultImpl } from './result'

export type InferOk<T> = T extends Ok<infer O, infer _> ? O : never

export type InferErr<T> = T extends Err<infer E, infer _> ? E : never

export type ExtractOk<T> = T extends Ok<infer O, infer _> ? O : T extends Result<infer O, infer _> ? O : never

export type ExtractErr<T> = T extends Err<infer E, infer _> ? E : T extends Result<infer _, infer E> ? E : never

export function isResult<Input>(value: Input): value is Input & Result<unknown, unknown> {
  return value instanceof ResultImpl
}

export function isAsyncResult<Input>(value: Input): value is Input & AsyncResult<unknown, unknown> {
  return value instanceof AsyncResult
}

export function isOption<Input>(value: Input): value is Input & Option<unknown> {
  return value instanceof OptionImpl
}

export function isAsyncOption<Input>(value: Input): value is Input & AsyncOption<unknown> {
  return value instanceof AsyncOption
}
