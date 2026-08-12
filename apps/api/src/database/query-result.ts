export function readQueryRows<T extends object>(result: unknown): readonly T[] {
  const rows =
    Array.isArray(result) &&
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === 'number'
      ? result[0]
      : result;

  if (
    !Array.isArray(rows) ||
    rows.some((row) => typeof row !== 'object' || row === null)
  ) {
    throw new Error('Database query returned an invalid row set');
  }
  return rows as readonly T[];
}
