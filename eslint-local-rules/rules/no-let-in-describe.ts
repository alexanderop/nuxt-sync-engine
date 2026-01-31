import type { Rule } from 'eslint'

/**
 * Rule: no-let-in-describe
 *
 * Disallows `let` declarations directly inside describe blocks.
 * Mutable test state leads to flaky tests and order-dependent failures.
 *
 * Bad:
 *   describe('User', () => {
 *     let user: User  // ❌ Mutable state shared between tests
 *   })
 *
 * Good:
 *   describe('User', () => {
 *     const createUser = () => ({ id: 1 })  // ✅ Factory function
 *   })
 */

function isDescribeCall(node: Rule.Node): boolean {
  if (node.type !== 'CallExpression')
    return false
  const callee = node.callee
  if (callee.type === 'Identifier') {
    return ['describe', 'fdescribe', 'xdescribe'].includes(callee.name)
  }
  if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier') {
    return callee.object.name === 'describe'
  }
  return false
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow `let` declarations in describe blocks to prevent shared mutable test state',
      recommended: true,
    },
    messages: {
      noLetInDescribe: 'Avoid `let` in describe blocks. Use factory functions, `const`, or declare variables inside individual tests.',
    },
    schema: [],
  },
  create(context) {
    const describeStack: boolean[] = []

    return {
      CallExpression(node) {
        if (isDescribeCall(node)) {
          describeStack.push(true)
        }
      },
      'CallExpression:exit'(node) {
        if (isDescribeCall(node)) {
          describeStack.pop()
        }
      },
      VariableDeclaration(node) {
        // Only report if we're directly in a describe block (not nested in it/beforeEach)
        if (describeStack.length > 0 && node.kind === 'let') {
          // Check if we're in the callback of describe, not in a nested function
          const parent = node.parent
          if (parent?.type === 'BlockStatement') {
            const grandparent = parent.parent
            if (
              grandparent?.type === 'ArrowFunctionExpression'
              || grandparent?.type === 'FunctionExpression'
            ) {
              const greatGrandparent = grandparent.parent
              if (greatGrandparent?.type === 'CallExpression' && isDescribeCall(greatGrandparent)) {
                context.report({
                  node,
                  messageId: 'noLetInDescribe',
                })
              }
            }
          }
        }
      },
    }
  },
}

export default rule
