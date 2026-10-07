# Using Result and Option

Import Result utilities from `@hoseki/packages/result`. `Result<T, E>` is
`Ok(value)` or `Err(error)`; `Option<T>` is `Some(value)` or `None`.
Use typed errors for expected failures and reserve `Panic` for unexpected
invariant violations.

```ts
const result = lookup(id)
if (result.isOk()) {
  result.unwrap()
} else {
  result.unwrapErr()
}
```

`unwrap()` and `unwrapErr()` require variant narrowing. Await an `AsyncResult`
before narrowing it. Use `unwrapOr` / `unwrapOrElse` when a fallback is intended;
use `expect(message)` / `expectErr(message)` in tests or for documented invariants.

Use ordinary functions returning method chains for simple transformations.
For multi-step control flow, use `tryBlock` with direct delegation:

```ts
const result = tryBlock(async function* () {
  const first = yield* asyncLookup(id)
  const second = yield* await promisedLookup(first)
  return Ok(second)
})
```

Synchronous generators return `Result`; async generators return `AsyncResult`.
Errors preserve the original `Err` instance and close the generator, running
`finally` cleanup. Unexpected async failures become `Panic`.

## Migration from Patina v3

- Replace `value()` / `error()` with narrowed `unwrap()` / `unwrapErr()`.
- Replace `Result.from` with `Result.fromThrowable`, and `Option.from` with
  `Option.fromNullish`.
- Replace `yield* result.try()` with `yield* result`, and `tryBlockAsync` with
  `tryBlock`. Native `Promise<Result>` values need `yield* await`.
- Replace `fn` / `asyncFn` with ordinary functions returning `Result` /
  `AsyncResult` through method chains or `tryBlock` scopes, not direct
  `new AsyncResult` wrappers around async callbacks. Use `yield*` to propagate
  typed failures; convert expected native promise failures with `Result.fromPromise`.
- Replace eager `and` / `or` with lazy `andThen` / `orElse`, and combined
  predicates with explicit variant checks.
- Use `AsyncOk`, `AsyncErr`, `AsyncSome`, and `AsyncNone` for async variants.
  `AsyncResult.fromPromise` / `fromThrowable` normalize expected failures;
  `AsyncOption.fromNullish` awaits optional values.
- Async `.catch()` handles promise rejection, not a resolved `Err` / `None`;
  use `orElse` for recovery. `.finally()` waits for cleanup.
- Tests comparing whole Results must register `test-equality.setup.ts` so
  Vitest does not consume their control-flow iterators.

`pnpm check` includes this package's runtime and type regression tests.

The [core provenance](./lib/core/README.md) records the source commits and license.
