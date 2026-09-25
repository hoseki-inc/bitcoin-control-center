// Preserve the imported API while allowing test doubles to omit unused members
// and return partial fixtures. Function parameters are bivariant so a mock may
// accept only the inputs exercised by its tests; unrelated types are rejected.
// This checks fixture compatibility, not completeness or all generic overloads.
export type PartialModuleMock<T> =
  | T
  | (T extends abstract new (...args: infer Args) => infer Instance
      ? (new (...args: Args) => PartialModuleMock<Instance>) & PartialMockProperties<T>
      : T extends (...args: infer Args) => infer Value
        ? { invoke(...args: Args): PartialModuleMock<Value> }['invoke'] & PartialMockProperties<T>
        : T extends PromiseLike<infer Value>
          ? PromiseLike<PartialModuleMock<Value>>
          : T extends readonly (infer Item)[]
            ? readonly PartialModuleMock<Item>[]
            : T extends object
              ? PartialMockProperties<T>
              : never)

type PartialMockProperties<T> = { [Key in keyof T]?: PartialModuleMock<T[Key]> }
