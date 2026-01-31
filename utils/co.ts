/**
 * Jazz-Inspired Schema Builder
 * ============================
 *
 * This file provides a simplified version of Jazz's schema system.
 * It lets you define schemas declaratively and generates SQLite tables.
 *
 * ```typescript
 * // Define a schema (Jazz-like API)
 * const Todo = co.map({
 *   text: z.string(),
 *   completed: z.boolean(),
 * });
 *
 * // Create an instance
 * const todo = Todo.create({ text: 'Buy milk', completed: false });
 *
 * // Access Jazz-like metadata
 * console.log(todo.$jazz.id);        // UUID
 * console.log(todo.$jazz.createdAt); // timestamp
 * console.log(todo.$jazz.updatedAt); // timestamp
 * ```
 *
 * > **What Jazz Does Better**
 * >
 * > Jazz's real `co.map()` provides:
 * > - Cryptographic signatures on all changes
 * > - Session-based transaction ordering
 * > - Automatic permission inheritance
 * > - End-to-end encryption
 * > - CRDT-based conflict resolution
 * >
 * > Our version uses simple timestamps and last-write-wins.
 */

import { z } from 'zod'

// =============================================================================
// TYPES
// =============================================================================

/**
 * Metadata attached to every CoValue instance.
 * Jazz calls this the "header" and includes cryptographic signatures.
 * We simplify to just timestamps and device tracking.
 */
export interface CoValueMeta {
  /** Globally unique identifier (UUID) */
  id: string
  /** Unix timestamp (ms) when created */
  createdAt: number
  /** Unix timestamp (ms) when last modified */
  updatedAt: number
  /** Device that last modified this value */
  deviceId: string
  /** Soft delete flag for sync */
  deleted: boolean
}

/**
 * A CoValue is any value with Jazz-like metadata.
 * The $jazz property provides access to sync metadata.
 */
export interface CoValue<T = Record<string, unknown>> {
  $jazz: CoValueMeta
  /** The actual data */
  data: T
}

/**
 * Schema field definition with Zod validation.
 */
export type SchemaField = z.ZodTypeAny

/**
 * Schema shape - a record of field names to Zod types.
 */
export type SchemaShape = Record<string, SchemaField>

/**
 * Infer the TypeScript type from a schema shape.
 */
export type InferShape<S extends SchemaShape> = {
  [K in keyof S]: z.infer<S[K]>;
}

/**
 * A CoMap schema definition.
 */
export interface CoMapSchema<S extends SchemaShape> {
  /** The schema shape with Zod types */
  shape: S
  /** Schema name for table generation */
  name: string
  /** Create a new instance with this schema */
  create: (
    data: InferShape<S>,
    options?: { deviceId?: string },
  ) => CoValue<InferShape<S>>
  /** Validate data against the schema */
  validate: (data: unknown) => InferShape<S>
  /** Generate SQLite CREATE TABLE statement */
  toSql: () => string
  /** Get column definitions for SQLite */
  getColumns: () => ColumnDef[]
}

/**
 * Column definition for SQLite table generation.
 */
export interface ColumnDef {
  name: string
  type: 'TEXT' | 'INTEGER' | 'REAL' | 'BLOB'
  nullable: boolean
  defaultValue?: string | number | null
}

/**
 * A CoList schema definition (array of items).
 */
export interface CoListSchema<T extends CoMapSchema<SchemaShape>> {
  /** The item schema */
  itemSchema: T
  /** Create an empty list */
  create: (options?: { deviceId?: string }) => CoValue<Array<InferShape<T['shape']>>>
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Map Zod type to SQLite column type.
 */
function zodToSqlType(schema: z.ZodTypeAny): ColumnDef['type'] {
  // Unwrap optionals and nullables
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return zodToSqlType(schema.unwrap())
  }

  // Check for specific types
  if (schema instanceof z.ZodString)
    return 'TEXT'
  if (schema instanceof z.ZodNumber)
    return 'REAL'
  if (schema instanceof z.ZodBoolean)
    return 'INTEGER' // SQLite uses 0/1
  if (schema instanceof z.ZodDate)
    return 'INTEGER' // Store as Unix timestamp
  if (schema instanceof z.ZodArray)
    return 'TEXT' // Store as JSON
  if (schema instanceof z.ZodObject)
    return 'TEXT' // Store as JSON
  if (schema instanceof z.ZodEnum)
    return 'TEXT'
  if (schema instanceof z.ZodLiteral) {
    const value = schema.value
    if (typeof value === 'string')
      return 'TEXT'
    if (typeof value === 'number')
      return 'REAL'
    if (typeof value === 'boolean')
      return 'INTEGER'
    return 'TEXT'
  }

  // Default to TEXT (JSON serialized)
  return 'TEXT'
}

/**
 * Check if a Zod schema is optional/nullable.
 */
function isOptional(schema: z.ZodTypeAny): boolean {
  return (
    schema instanceof z.ZodOptional
    || schema instanceof z.ZodNullable
    || schema.isOptional()
  )
}

/**
 * Generate a UUID using crypto.randomUUID().
 * This is a simplified version - Jazz uses cryptographic IDs.
 */
function generateId(): string {
  return crypto.randomUUID()
}

/**
 * Get current timestamp in milliseconds.
 */
function now(): number {
  return Date.now()
}

// =============================================================================
// SCHEMA BUILDERS
// =============================================================================

/**
 * Create a CoMap schema (like Jazz's co.map).
 *
 * @example
 * ```typescript
 * const Todo = co.map({
 *   text: z.string(),
 *   completed: z.boolean(),
 * });
 *
 * const todo = Todo.create({ text: 'Buy milk', completed: false });
 * ```
 */
function createCoMapSchema<S extends SchemaShape>(
  shape: S,
  name?: string,
): CoMapSchema<S> {
  // Create a combined Zod schema for validation
  const zodSchema = z.object(shape)

  // Generate a name if not provided
  const schemaName = name || `CoMap_${Object.keys(shape).join('_')}`

  // Get column definitions
  const getColumns = (): ColumnDef[] => {
    const columns: ColumnDef[] = [
      // Jazz-like metadata columns (always present)
      { name: 'id', type: 'TEXT', nullable: false },
      { name: 'created_at', type: 'INTEGER', nullable: false },
      { name: 'updated_at', type: 'INTEGER', nullable: false },
      { name: 'device_id', type: 'TEXT', nullable: false },
      { name: 'deleted', type: 'INTEGER', nullable: false, defaultValue: 0 },
    ]

    // Add data columns from schema
    for (const [key, fieldSchema] of Object.entries(shape)) {
      columns.push({
        name: key,
        type: zodToSqlType(fieldSchema),
        nullable: isOptional(fieldSchema),
      })
    }

    return columns
  }

  // Generate SQL CREATE TABLE statement
  const toSql = (): string => {
    const columns = getColumns()
    const columnDefs = columns.map((col) => {
      let def = `${col.name} ${col.type}`
      if (!col.nullable)
        def += ' NOT NULL'
      if (col.defaultValue !== undefined) {
        def += ` DEFAULT ${col.defaultValue}`
      }
      return def
    })

    return `CREATE TABLE IF NOT EXISTS ${schemaName} (
  ${columnDefs.join(',\n  ')},
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_${schemaName}_updated_at ON ${schemaName}(updated_at);
CREATE INDEX IF NOT EXISTS idx_${schemaName}_deleted ON ${schemaName}(deleted);`
  }

  // Create a new instance
  const create = (
    data: InferShape<S>,
    options?: { deviceId?: string },
  ): CoValue<InferShape<S>> => {
    // Validate data
    const validated = zodSchema.parse(data)
    const timestamp = now()

    return {
      $jazz: {
        id: generateId(),
        createdAt: timestamp,
        updatedAt: timestamp,
        deviceId: options?.deviceId || 'unknown',
        deleted: false,
      },
      data: validated as InferShape<S>,
    }
  }

  // Validate data
  const validate = (data: unknown): InferShape<S> => {
    return zodSchema.parse(data) as InferShape<S>
  }

  return {
    shape,
    name: schemaName,
    create,
    validate,
    toSql,
    getColumns,
  }
}

/**
 * Create a CoList schema (like Jazz's co.list).
 *
 * @example
 * ```typescript
 * const TodoList = co.list(Todo);
 * ```
 */
function createCoListSchema<T extends CoMapSchema<SchemaShape>>(
  itemSchema: T,
): CoListSchema<T> {
  const create = (
    options?: { deviceId?: string },
  ): CoValue<Array<InferShape<T['shape']>>> => {
    const timestamp = now()
    return {
      $jazz: {
        id: generateId(),
        createdAt: timestamp,
        updatedAt: timestamp,
        deviceId: options?.deviceId || 'unknown',
        deleted: false,
      },
      data: [],
    }
  }

  return {
    itemSchema,
    create,
  }
}

// =============================================================================
// CO NAMESPACE (Jazz-like API)
// =============================================================================

/**
 * The `co` namespace provides Jazz-like schema builders.
 *
 * > **What Jazz Does Better**
 * >
 * > Jazz's `co` object also provides:
 * > - `co.profile()` - User profile with automatic public visibility
 * > - `co.account()` - Full account schema with migrations
 * > - `co.plainText()` - Collaborative plain text (CRDT)
 * > - `co.richText()` - Collaborative rich text editing
 * > - `co.image()` - Image handling with progressive loading
 * > - `co.fileStream()` - File streaming/upload support
 * > - `co.feed()` - Append-only feeds
 * > - `.withPermissions()` - Permission configuration
 * > - `.withMigration()` - Schema migration support
 * > - `.resolved()` - Define loading strategies
 * >
 * > We only implement `map` and `list` for simplicity.
 */
export const co = {
  /**
   * Define a collaborative map (object with named fields).
   *
   * @example
   * ```typescript
   * const Todo = co.map({
   *   text: z.string(),
   *   completed: z.boolean(),
   * });
   * ```
   */
  map: <S extends SchemaShape>(shape: S, name?: string): CoMapSchema<S> => {
    return createCoMapSchema(shape, name)
  },

  /**
   * Define a collaborative list (array of items).
   *
   * @example
   * ```typescript
   * const TodoList = co.list(Todo);
   * ```
   */
  list: <T extends CoMapSchema<SchemaShape>>(itemSchema: T): CoListSchema<T> => {
    return createCoListSchema(itemSchema)
  },

  /**
   * Mark a field as optional.
   *
   * @example
   * ```typescript
   * const Person = co.map({
   *   name: z.string(),
   *   nickname: co.optional(z.string()),
   * });
   * ```
   */
  optional: <T extends z.ZodTypeAny>(schema: T): z.ZodOptional<T> => {
    return schema.optional()
  },
}

// =============================================================================
// UTILITY FUNCTIONS FOR DATABASE OPERATIONS
// =============================================================================

/**
 * Convert a CoValue to a flat object for database insertion.
 */
export function coValueToRow<S extends SchemaShape>(
  coValue: CoValue<InferShape<S>>,
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: coValue.$jazz.id,
    created_at: coValue.$jazz.createdAt,
    updated_at: coValue.$jazz.updatedAt,
    device_id: coValue.$jazz.deviceId,
    deleted: coValue.$jazz.deleted ? 1 : 0,
  }

  // Add data fields
  for (const [key, value] of Object.entries(coValue.data)) {
    // Convert booleans to integers for SQLite
    if (typeof value === 'boolean') {
      row[key] = value ? 1 : 0
    }
    // Convert dates to timestamps
    else if (value instanceof Date) {
      row[key] = value.getTime()
    }
    // Convert objects/arrays to JSON
    else if (typeof value === 'object' && value !== null) {
      row[key] = JSON.stringify(value)
    }
    // Keep primitives as-is
    else {
      row[key] = value
    }
  }

  return row
}

/**
 * Convert a database row back to a CoValue.
 */
export function rowToCoValue<S extends SchemaShape>(
  row: Record<string, unknown>,
  schema: CoMapSchema<S>,
): CoValue<InferShape<S>> {
  const data: Record<string, unknown> = {}

  // Extract data fields based on schema
  for (const [key, fieldSchema] of Object.entries(schema.shape)) {
    const value = row[key]

    // Convert integers back to booleans
    if (fieldSchema instanceof z.ZodBoolean) {
      data[key] = value === 1 || value === true
    }
    // Convert timestamps back to dates
    else if (fieldSchema instanceof z.ZodDate) {
      data[key] = typeof value === 'number' ? new Date(value) : value
    }
    // Parse JSON for objects/arrays
    else if (
      fieldSchema instanceof z.ZodObject
      || fieldSchema instanceof z.ZodArray
    ) {
      data[key] = typeof value === 'string' ? JSON.parse(value) : value
    }
    // Keep primitives as-is
    else {
      data[key] = value
    }
  }

  return {
    $jazz: {
      id: row.id as string,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      deviceId: row.device_id as string,
      deleted: row.deleted === 1,
    },
    data: data as InferShape<S>,
  }
}

/**
 * Update the $jazz metadata for a modification.
 */
export function touch<T>(coValue: CoValue<T>, deviceId: string): CoValue<T> {
  return {
    ...coValue,
    $jazz: {
      ...coValue.$jazz,
      updatedAt: now(),
      deviceId,
    },
  }
}

/**
 * Mark a CoValue as deleted (soft delete).
 */
export function markDeleted<T>(coValue: CoValue<T>, deviceId: string): CoValue<T> {
  return {
    ...coValue,
    $jazz: {
      ...coValue.$jazz,
      updatedAt: now(),
      deviceId,
      deleted: true,
    },
  }
}

// Re-export Zod for convenience
export { z }
