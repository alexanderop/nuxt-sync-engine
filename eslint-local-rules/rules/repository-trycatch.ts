import type { Rule } from 'eslint'

/**
 * Rule: repository-trycatch
 *
 * Database operations should be wrapped in tryCatch for proper error handling.
 * This applies to methods that look like database operations.
 *
 * Bad:
 *   const result = db.prepare(query).run()
 *
 * Good:
 *   const [error, result] = await tryCatch(db.prepare(query).run())
 */

// Method names that indicate database operations
const DB_METHOD_PATTERNS = [
  'prepare',
  'run',
  'get',
  'all',
  'exec',
  'query',
  'execute',
  'insert',
  'update',
  'delete',
  'select',
  'findOne',
  'findMany',
  'create',
  'save',
]

function isTryCatchCall(node: Rule.Node): boolean {
  if (node.type !== 'CallExpression')
    return false
  const callee = node.callee
  if (callee.type === 'Identifier') {
    return callee.name === 'tryCatch' || callee.name === 'tryCatchSync'
  }
  return false
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Database operations should be wrapped in tryCatch',
      recommended: false,
    },
    messages: {
      wrapInTryCatch: 'Database operation "{{ method }}" should be wrapped in tryCatch for proper error handling.',
    },
    schema: [],
  },
  create(context) {
    // Track if we're inside a tryCatch call
    let inTryCatch = 0
    let inTryCatchBlock = 0

    function isDbMethod(name: string): boolean {
      return DB_METHOD_PATTERNS.some(pattern =>
        name === pattern || name.toLowerCase().includes(pattern.toLowerCase()),
      )
    }

    return {
      CallExpression(node) {
        if (isTryCatchCall(node)) {
          inTryCatch++
        }
      },
      'CallExpression:exit'(node) {
        if (isTryCatchCall(node)) {
          inTryCatch--
        }
      },
      TryStatement() {
        inTryCatchBlock++
      },
      'TryStatement:exit'() {
        inTryCatchBlock--
      },
      'CallExpression > MemberExpression'(node: Rule.Node & { property: { type: string, name?: string } }) {
        // Skip if we're inside a tryCatch call or try block
        if (inTryCatch > 0 || inTryCatchBlock > 0)
          return

        const property = node.property
        if (property.type === 'Identifier' && property.name && isDbMethod(property.name)) {
          // Check if the object looks like a database connection
          const memberExpr = node as Rule.Node & { object: { type: string, name?: string } }
          const obj = memberExpr.object

          // Heuristic: if it's called on 'db', 'database', 'connection', 'stmt', 'statement', etc.
          const dbLikeNames = ['db', 'database', 'connection', 'conn', 'stmt', 'statement', 'client', 'pool']
          const isDbObject = obj.type === 'Identifier' && dbLikeNames.includes(obj.name?.toLowerCase() || '')

          // Or if it's a chained call like db.prepare().run()
          const isChainedDbCall = obj.type === 'CallExpression'

          if (isDbObject || (isChainedDbCall && property.name === 'run')) {
            context.report({
              node,
              messageId: 'wrapInTryCatch',
              data: { method: property.name },
            })
          }
        }
      },
    }
  },
}

export default rule
