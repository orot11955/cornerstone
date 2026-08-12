import eslint from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export function createTypeScriptConfig({
  tsconfigRootDir,
  environment = 'node',
  ignores = [],
} = {}) {
  if (!tsconfigRootDir) throw new Error('tsconfigRootDir is required')
  const runtimeGlobals = environment === 'browser' ? globals.browser : globals.node

  return tseslint.config(
    { ignores: ['dist/**', 'coverage/**', ...ignores] },
    eslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    eslintConfigPrettier,
    {
      languageOptions: {
        globals: runtimeGlobals,
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/no-unsafe-argument': 'error',
      },
    },
  )
}
