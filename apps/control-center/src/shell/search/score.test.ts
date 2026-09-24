import { assert, describe, expect, it } from 'vitest'
import { rankCommands, scoreCommand, scoreText } from './score'

describe('scoreText', () => {
  it('ranks exact, prefix, word-start, substring and in-order matches', () => {
    expect(scoreText('portfolio', 'Portfolio')).toBe(1)
    expect(scoreText('port', 'Portfolio')).toBe(0.9)
    expect(scoreText('wall', 'Cold wallet')).toBe(0.8)
    expect(scoreText('olio', 'Portfolio')).toBe(0.6)
    const fuzzy = scoreText('stmt', 'Statements')
    expect(fuzzy).toBeGreaterThan(0)
    expect(fuzzy).toBeLessThan(0.6)
    expect(scoreText('xyz', 'Portfolio')).toBe(0)
  })

  it('matches multi-word queries against word starts in any order', () => {
    expect(scoreText('dark switch', 'Switch to dark mode')).toBe(0.75)
  })

  it('treats an empty query as a match for everything', () => {
    expect(scoreText('  ', 'Anything')).toBe(1)
  })
})

describe('rankCommands', () => {
  const commands = [
    { label: 'Settings', keywords: ['preferences', 'electrum'] },
    { label: 'Statements', keywords: ['pdf', 'proof of reserves'] },
    { label: 'Cold Storage' },
  ]

  it('orders by score and drops non-matches', () => {
    expect(rankCommands('st', commands).map((c) => c.label)).toEqual(['Statements', 'Cold Storage', 'Settings'])
    expect(rankCommands('pdf', commands).map((c) => c.label)).toEqual(['Statements'])
  })

  it('finds commands by keyword, slightly below a label match', () => {
    const first = commands[0]
    assert(first !== undefined)
    expect(scoreCommand('electrum', first)).toBeCloseTo(0.9)
  })

  it('keeps the original order for an empty query', () => {
    expect(rankCommands('', commands)).toEqual(commands)
  })
})
