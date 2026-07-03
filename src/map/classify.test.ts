import { describe, it, expect } from 'vitest'
import { isNamedScreen, tokenize, commonWords } from './classify'

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

describe('tokenize', () => {
  it('splits on separators, camelCase, and letter↔digit boundaries', () => {
    expect(tokenize('WALL_SCREEN_01')).toEqual(['WALL', 'SCREEN'])
    expect(tokenize('VideoWall')).toEqual(['Video', 'Wall'])
    expect(tokenize('Wall_Outside1')).toEqual(['Wall', 'Outside'])
    expect(tokenize('Pillar-Outside.02')).toEqual(['Pillar', 'Outside'])
  })

  it('drops single characters and pure numbers', () => {
    expect(tokenize('A_1_screen_9')).toEqual(['screen'])
  })
})

describe('commonWords', () => {
  it('surfaces words shared across ≥2 objects, counted once per object, sorted by frequency', () => {
    const names = [
      'FLOOR_SCREEN',
      'PILLAR_SCREEN',
      'WALL_SCREEN_01',
      'WALL_SCREEN_02',
      'Floor_Outside',
      'Pillar_Outside',
      'Cloner', // unique — no shared word
    ]
    const words = commonWords(names)
    const asObj = Object.fromEntries(words.map((w) => [w.label.toLowerCase(), w.count]))
    expect(asObj.screen).toBe(4) // FLOOR, PILLAR, WALL_01, WALL_02
    expect(asObj.wall).toBe(2)
    expect(asObj.floor).toBe(2) // FLOOR_SCREEN + Floor_Outside
    expect(asObj.outside).toBe(2)
    expect(asObj.pillar).toBe(2)
    expect(asObj.cloner).toBeUndefined() // appears once → not shared
    // frequency-sorted: screen (4) first
    expect(words[0].label.toLowerCase()).toBe('screen')
  })

  it('counts a word once even if it repeats within a single name', () => {
    expect(commonWords(['SCREEN_SCREEN_A', 'SCREEN_B'])).toEqual([{ label: 'SCREEN', count: 2 }])
  })

  it('returns nothing when all names are unique', () => {
    expect(commonWords(['Alpha', 'Beta', 'Gamma'])).toEqual([])
  })
})
