import antfu from '@antfu/eslint-config'
import pluginImportX from 'eslint-plugin-import-x'
import oxlint from 'eslint-plugin-oxlint'
import pluginUnicorn from 'eslint-plugin-unicorn'
import localRules from './eslint-local-rules/index.ts'

export default antfu(
  {
    vue: true,
    typescript: true,
    test: true, // Enable antfu's built-in vitest rules
    ignores: [
      '.claude/**',
      '.github/skills/**',
      'docs/**/*.md',
      'BLOG_POST.md',
      'eslint-local-rules/**',
    ],
  },

  // Oxlint compatibility - skip rules that oxlint handles
  oxlint.configs['flat/recommended'],

  // ============================================
  // Global rules for all files
  // ============================================
  {
    plugins: {
      'import-x': pluginImportX,
      'unicorn': pluginUnicorn,
      'local': localRules,
    },
    rules: {
      // -----------------------------------------
      // Complexity & Readability
      // -----------------------------------------
      'complexity': ['error', { max: 10 }],
      'no-nested-ternary': 'error',
      'no-else-return': ['error', { allowElseIf: false }],
      'max-depth': ['warn', { max: 4 }],

      // -----------------------------------------
      // TypeScript Strictness
      // -----------------------------------------
      '@typescript-eslint/consistent-type-assertions': ['error', {
        assertionStyle: 'never',
      }],
      // Ban enums in favor of unions
      'no-restricted-syntax': ['error', {
        selector: 'TSEnumDeclaration',
        message: 'Use union types instead of enums. Example: type Status = "active" | "inactive"',
      }],

      // -----------------------------------------
      // Import Organization
      // -----------------------------------------
      'import-x/no-restricted-paths': ['error', {
        zones: [
          // Server code should not import from app/
          {
            target: './server/**/*',
            from: './app/**/*',
            message: 'Server code cannot import from app/. Use shared/ for shared code.',
          },
          // App code should not directly import server internals
          {
            target: './app/**/*',
            from: './server/utils/**/*',
            message: 'App code cannot import server utilities directly. Use API endpoints.',
          },
        ],
      }],

      // -----------------------------------------
      // Unicorn (Modern JS Patterns)
      // -----------------------------------------
      'unicorn/prefer-node-protocol': 'error',
      'unicorn/no-array-for-each': 'warn',
      'unicorn/prefer-array-find': 'warn',
      'unicorn/prefer-array-some': 'warn',
      'unicorn/prefer-includes': 'warn',
      'unicorn/prefer-string-starts-ends-with': 'warn',
      'unicorn/prefer-ternary': 'off', // Can conflict with no-nested-ternary

      // -----------------------------------------
      // Local Rules (all files)
      // -----------------------------------------
      // composable-must-use-vue is disabled globally, enabled only outside app/ (Nuxt auto-imports)
      'local/composable-must-use-vue': 'off',
      'local/no-hardcoded-colors': 'warn',
      'local/extract-condition-variable': ['warn', { maxOperators: 2 }],

      // -----------------------------------------
      // Console (handled by oxlint, but keep as backup)
      // -----------------------------------------
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },

  // ============================================
  // Vue-specific rules
  // ============================================
  {
    files: ['**/*.vue'],
    rules: {
      // Dead code detection
      'vue/no-unused-properties': 'warn',
      'vue/no-unused-refs': 'warn',
      'vue/no-unused-emit-declarations': 'warn',

      // Naming conventions
      'vue/component-name-in-template-casing': ['error', 'PascalCase', {
        registeredComponentsOnly: false,
      }],

      // Vue 3.5+ patterns
      'vue/define-props-destructuring': 'warn',
      'vue/prefer-use-template-ref': 'warn',
      'vue/require-expose': 'warn',

      // Template best practices
      'vue/no-v-html': 'warn',
      'vue/prefer-true-attribute-shorthand': 'warn',
    },
  },

  // ============================================
  // Test files
  // ============================================
  {
    files: ['**/*.test.ts', '**/*.spec.ts', 'tests/**/*.ts'],
    rules: {
      // Local rule for test structure
      'local/no-let-in-describe': 'error',

      // Vitest best practices (uses antfu's built-in 'test' plugin)
      'test/expect-expect': 'warn',
      'test/no-identical-title': 'error',
      'test/no-focused-tests': 'error',
      'test/no-disabled-tests': 'warn',
      'test/prefer-to-be': 'warn',
      'test/prefer-to-have-length': 'warn',

      // Relax some rules for tests
      '@typescript-eslint/consistent-type-assertions': 'off',
      'no-console': 'off',
    },
  },

  // ============================================
  // Server-specific rules
  // ============================================
  {
    files: ['server/**/*.ts'],
    rules: {
      // Database operations should use tryCatch
      'local/repository-trycatch': 'warn',
    },
  },

  // ============================================
  // Non-Nuxt composables (outside app/ where auto-imports don't apply)
  // ============================================
  {
    files: ['composables/**/*.ts', 'lib/**/*.ts', 'packages/**/*.ts'],
    rules: {
      'local/composable-must-use-vue': 'error',
    },
  },
)
