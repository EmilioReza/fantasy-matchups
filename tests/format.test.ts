import { describe, expect, it } from 'vitest';
import { pctPair } from '../src/format.ts';

describe('win percentages', () => {
  it('always add up to 100, even when both sides sit on .5', () => {
    expect(pctPair(0.505)).toEqual({ home: '51%', away: '49%' });
    expect(pctPair(0.495)).toEqual({ home: '50%', away: '50%' });
    for (let i = 0; i <= 1000; i++) {
      const { home, away } = pctPair(i / 1000);
      expect(parseInt(home) + parseInt(away)).toBe(100);
    }
  });
  it('clamps out-of-range input', () => {
    expect(pctPair(1.2)).toEqual({ home: '100%', away: '0%' });
    expect(pctPair(-0.1)).toEqual({ home: '0%', away: '100%' });
  });
});
