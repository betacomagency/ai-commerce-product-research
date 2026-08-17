import { describe, expect, it } from 'vitest'
import { BraveSearchProvider } from '../src/providers/search.js'

describe('BraveSearchProvider', () => {
  it('exposes a stable provider identity', () => {
    expect(new BraveSearchProvider().name).toBe('brave-search-html')
  })
})
