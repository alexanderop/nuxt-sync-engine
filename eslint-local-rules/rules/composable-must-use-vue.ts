import type { Rule } from 'eslint'
import path from 'node:path'

/**
 * Rule: composable-must-use-vue
 *
 * Files named use*.ts (composables) must import something from 'vue'.
 * This ensures composables are actually using Vue's reactivity system.
 */
const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Composables (use*.ts files) must import from Vue',
      recommended: true,
    },
    messages: {
      missingVueImport: 'Composable "{{ filename }}" must import from \'vue\'. Composables should use Vue\'s reactivity system (ref, computed, watch, etc.).',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename()
    const basename = path.basename(filename)

    // Only apply to use*.ts files (not .vue files)
    if (!basename.match(/^use[A-Z].*\.ts$/)) {
      return {}
    }

    let hasVueImport = false

    return {
      ImportDeclaration(node) {
        if (node.source.value === 'vue' || node.source.value === '#imports') {
          hasVueImport = true
        }
      },
      'Program:exit'() {
        if (!hasVueImport) {
          context.report({
            loc: { line: 1, column: 0 },
            messageId: 'missingVueImport',
            data: { filename: basename },
          })
        }
      },
    }
  },
}

export default rule
