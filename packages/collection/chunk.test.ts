import { expect, test } from 'vitest'
import { chunk } from './chunk'

test('chunk', () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  const chunks = chunk(values, 3)
  expect(chunks).toEqual([
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ])
})
