import { describe, it, expect } from 'vitest'
import { isNamedScreen } from './classify'

describe('isNamedScreen', () => {
  it('matches the built-in words with no extra keywords', () => {
    expect(isNamedScreen('WALL_SCREEN_01')).toBe(true)
    expect(isNamedScreen('LED_WALL_2')).toBe(true)
    expect(isNamedScreen('Truss_Support_04')).toBe(false)
  })

  it('does not match a custom word before it is added', () => {
    expect(isNamedScreen('CANVAS_A')).toBe(false)
  })

  it('matches a custom word once supplied, additively (built-ins still work)', () => {
    const extra = ['canvas', 'vidwall']
    expect(isNamedScreen('CANVAS_A', extra)).toBe(true)
    expect(isNamedScreen('Main_VidWall', extra)).toBe(true)
    expect(isNamedScreen('LED_WALL_2', extra)).toBe(true) // built-in still matches
    expect(isNamedScreen('Truss_Support_04', extra)).toBe(false) // unrelated still excluded
  })

  it('ignores blank/whitespace-only entries and is case-insensitive', () => {
    expect(isNamedScreen('canvas_a', ['', '  ', 'Canvas'])).toBe(true)
  })

  it('treats a keyword containing regex special characters as a literal match', () => {
    expect(isNamedScreen('FX(1)_A', ['fx(1)'])).toBe(true)
    expect(isNamedScreen('FX1_A', ['fx(1)'])).toBe(false)
  })
})
