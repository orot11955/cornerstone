import { readQueryRows } from './query-result.js';

describe('readQueryRows', () => {
  it('normalizes SELECT and UPDATE RETURNING driver shapes', () => {
    expect(readQueryRows<{ id: string }>([{ id: 'one' }])).toEqual([
      { id: 'one' },
    ]);
    expect(readQueryRows<{ id: string }>([[{ id: 'one' }], 1])).toEqual([
      { id: 'one' },
    ]);
  });

  it('rejects non-row results', () => {
    expect(() => readQueryRows('not rows')).toThrow('invalid row set');
  });
});
