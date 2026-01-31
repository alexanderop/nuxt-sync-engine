import type { Rule } from 'eslint'

/**
 * Rule: no-hardcoded-colors
 *
 * Bans hardcoded Tailwind color classes like bg-blue-500, text-red-400.
 * Encourages use of semantic color tokens like bg-primary, text-error.
 */

// Common Tailwind color names to ban
const TAILWIND_COLORS = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
]

// Prefixes that can have colors
const COLOR_PREFIXES = [
  'bg',
  'text',
  'border',
  'ring',
  'outline',
  'decoration',
  'shadow',
  'accent',
  'caret',
  'fill',
  'stroke',
  'from',
  'via',
  'to',
  'divide',
  'placeholder',
]

// Build regex pattern: (bg|text|...)-?(slate|gray|...)-?\d+
const colorPattern = new RegExp(
  `\\b(${COLOR_PREFIXES.join('|')})-?(${TAILWIND_COLORS.join('|')})-?\\d{2,3}\\b`,
  'g',
)

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow hardcoded Tailwind color classes, prefer semantic colors',
      recommended: false,
    },
    messages: {
      noHardcodedColor: 'Avoid hardcoded color "{{ color }}". Use semantic colors like bg-primary, text-error, border-muted instead.',
    },
    schema: [],
  },
  create(context) {
    function checkForHardcodedColors(node: Rule.Node, value: string) {
      const matches = value.matchAll(colorPattern)
      for (const match of matches) {
        context.report({
          node,
          messageId: 'noHardcodedColor',
          data: { color: match[0] },
        })
      }
    }

    return {
      // Check string literals in JSX/templates
      Literal(node) {
        if (typeof node.value === 'string') {
          checkForHardcodedColors(node, node.value)
        }
      },
      // Check template literals
      TemplateLiteral(node) {
        for (const quasi of node.quasis) {
          checkForHardcodedColors(node, quasi.value.raw)
        }
      },
    }
  },
}

export default rule
