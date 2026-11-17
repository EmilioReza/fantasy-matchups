import { describe, expect, it } from 'vitest';
import { validateAll } from '../scripts/validate-data.ts';

describe('schemas', () => {
  it('every generated file validates', () => {
    expect(validateAll()).toEqual([]);
  });
});
