import { readFile } from 'node:fs/promises';

describe('admin bootstrap build boundary', () => {
  it('excludes bootstrap sources from the runtime build', async () => {
    const config = JSON.parse(
      await readFile('tsconfig.build.json', 'utf8'),
    ) as { exclude: string[] };
    expect(config.exclude).toContain('src/database/admin-bootstrap');
  });

  it('excludes tests and prior output from the dedicated build', async () => {
    const config = JSON.parse(
      await readFile('tsconfig.admin-bootstrap.json', 'utf8'),
    ) as { exclude: string[] };
    expect(config.exclude).toEqual(
      expect.arrayContaining([
        '**/*.spec.ts',
        'dist',
        'dist-admin-bootstrap',
        'node_modules',
      ]),
    );
  });
});
