import tseslint from 'typescript-eslint'

export default tseslint.config(
  // Base recommended rules for TypeScript
  ...tseslint.configs.recommended,

  // Project-specific configuration
  {
    files: ['src/**/*.ts'],
    rules: {
      // Allow unused vars prefixed with _ (common pattern for intentionally unused params)
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Warn on explicit any — prefer proper types but don't block development
      '@typescript-eslint/no-explicit-any': 'warn',

      // MCP servers communicate over stdout — all logging MUST go to stderr.
      // Accidental console.log() would corrupt the JSON-RPC transport.
      'no-console': 'error',
    },
  },

  // Logger uses console.error() intentionally — all output goes to stderr,
  // which is safe for MCP servers (only stdout is the JSON-RPC transport).
  {
    files: ['src/utils/logger.ts'],
    rules: {
      'no-console': ['error', { allow: ['error'] }],
    },
  },

  // Global ignores (directories that should never be linted)
  {
    ignores: ['dist/', 'node_modules/', 'playground/', 'coverage/', 'tmp/'],
  },
)
