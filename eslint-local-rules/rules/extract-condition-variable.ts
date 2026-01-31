import type { Rule } from 'eslint'

/**
 * Rule: extract-condition-variable
 *
 * Complex conditions with 2+ logical operators should be extracted
 * to a named variable for readability.
 *
 * Bad:
 *   if (user.isActive && user.hasPermission && !user.isBanned) { }
 *
 * Good:
 *   const canAccessFeature = user.isActive && user.hasPermission && !user.isBanned
 *   if (canAccessFeature) { }
 */
const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Complex conditions should be extracted to named variables',
      recommended: false,
    },
    messages: {
      extractCondition: 'Complex condition with {{ count }} operators. Extract to a named variable for readability.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          maxOperators: {
            type: 'integer',
            minimum: 1,
            default: 2,
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options = context.options[0] || {}
    const maxOperators = options.maxOperators ?? 2

    function countLogicalOperators(node: Rule.Node): number {
      if (node.type !== 'LogicalExpression')
        return 0

      let count = 1 // Current operator
      count += countLogicalOperators((node as unknown as { left: Rule.Node }).left)
      count += countLogicalOperators((node as unknown as { right: Rule.Node }).right)
      return count
    }

    function checkCondition(condition: Rule.Node | null | undefined) {
      if (!condition)
        return
      if (condition.type !== 'LogicalExpression')
        return

      const operatorCount = countLogicalOperators(condition)
      if (operatorCount > maxOperators) {
        context.report({
          node: condition,
          messageId: 'extractCondition',
          data: { count: String(operatorCount) },
        })
      }
    }

    return {
      IfStatement(node) {
        checkCondition(node.test as Rule.Node)
      },
      WhileStatement(node) {
        checkCondition(node.test as Rule.Node)
      },
      DoWhileStatement(node) {
        checkCondition(node.test as Rule.Node)
      },
      ForStatement(node) {
        checkCondition(node.test as Rule.Node | null)
      },
      ConditionalExpression(node) {
        checkCondition(node.test as Rule.Node)
      },
    }
  },
}

export default rule
