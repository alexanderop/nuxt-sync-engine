import type { Rule } from 'eslint'

/**
 * Rule: no-with-defaults
 *
 * Forbids using withDefaults() in Vue components.
 * Use destructuring with default values instead:
 *
 * Bad:
 *   const props = withDefaults(defineProps<Props>(), { foo: 'bar' })
 *
 * Good:
 *   const { foo = 'bar' } = defineProps<Props>()
 */
const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Forbid withDefaults() in favor of destructuring defaults',
      recommended: true,
    },
    messages: {
      noWithDefaults: 'Use destructuring with default values instead of withDefaults(). Example: const { foo = "bar" } = defineProps<Props>()',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier'
          && node.callee.name === 'withDefaults'
        ) {
          context.report({
            node,
            messageId: 'noWithDefaults',
          })
        }
      },
    }
  },
}

export default rule
