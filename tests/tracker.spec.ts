import { describe, expect, it } from 'vitest'
import { TurnTracker } from '../src/client/tracker.ts'

describe('TurnTracker', () => {
  it('reports the duration of a turn it saw start', () => {
    const tracker = new TurnTracker()
    expect(tracker.observe('s1', true, 1000)).toBeNull()
    expect(tracker.observe('s1', false, 3500)).toEqual({ sessionId: 's1', elapsedMs: 2500 })
  })

  it('does not restart the clock on repeated running pushes', () => {
    const tracker = new TurnTracker()
    tracker.observe('s1', true, 1000)
    tracker.observe('s1', true, 2000)
    expect(tracker.observe('s1', false, 4000)).toEqual({ sessionId: 's1', elapsedMs: 3000 })
  })

  it('reports an unknown duration when the start was missed', () => {
    const tracker = new TurnTracker()
    expect(tracker.observe('s9', false, 5000)).toEqual({ sessionId: 's9', elapsedMs: -1 })
  })

  it('tracks sessions independently', () => {
    const tracker = new TurnTracker()
    tracker.observe('a', true, 0)
    tracker.observe('b', true, 100)
    expect(tracker.observe('a', false, 500)).toEqual({ sessionId: 'a', elapsedMs: 500 })
    expect(tracker.observe('b', false, 900)).toEqual({ sessionId: 'b', elapsedMs: 800 })
  })

  it('forgets and clears', () => {
    const tracker = new TurnTracker()
    tracker.observe('a', true, 0)
    tracker.forget('a')
    expect(tracker.startOf('a')).toBeUndefined()
    tracker.observe('b', true, 0)
    tracker.clear()
    expect(tracker.startOf('b')).toBeUndefined()
  })
})
