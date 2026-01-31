/**
 * Application Schema Definitions
 * ==============================
 *
 * This file defines our data schemas using the Jazz-like co.map() builder.
 * These schemas generate SQLite tables and provide type-safe operations.
 *
 * > **What Jazz Does Better**
 * >
 * > In Jazz, you'd also define:
 * > - Account schemas with profile and root data
 * > - Permission groups and roles
 * > - Schema migrations for version upgrades
 * > - References between CoValues (like foreign keys, but better)
 * >
 * > Our simplified version just defines the data shape.
 */

import type { CoValue, InferShape } from './co'
import { co, z } from './co'

// =============================================================================
// TODO SCHEMA
// =============================================================================

/**
 * Todo item schema - the main entity we're syncing.
 *
 * In Jazz, this would be:
 * ```typescript
 * import { co, z } from "jazz-tools";
 *
 * export const Todo = co.map({
 *   text: co.plainText(),  // Collaborative text with CRDT
 *   completed: z.boolean(),
 * }).withPermissions({
 *   onInlineCreate: "sameAsContainer",
 * });
 * ```
 *
 * Our simplified version uses regular strings and timestamps for sync.
 */
export const Todo = co.map(
  {
    text: z.string().min(1, 'Todo text cannot be empty'),
    completed: z.boolean(),
  },
  'todos',
)

/** TypeScript type for Todo data */
export type TodoData = InferShape<typeof Todo.shape>

/** TypeScript type for a full Todo CoValue (with $jazz metadata) */
export type TodoValue = CoValue<TodoData>

// =============================================================================
// PROJECT SCHEMA (Optional - for future expansion)
// =============================================================================

/**
 * Project schema - a container for todos.
 *
 * In Jazz, you'd use references:
 * ```typescript
 * export const Project = co.map({
 *   name: z.string(),
 *   todos: co.list(Todo),  // Reference to a list of todos
 * });
 * ```
 *
 * We keep it simple with just the project data.
 */
export const Project = co.map(
  {
    name: z.string().min(1, 'Project name cannot be empty'),
    color: z.string().regex(/^#[0-9a-f]{6}$/i, 'Must be a hex color'),
  },
  'projects',
)

/** TypeScript type for Project data */
export type ProjectData = InferShape<typeof Project.shape>

/** TypeScript type for a full Project CoValue */
export type ProjectValue = CoValue<ProjectData>

// =============================================================================
// SCHEMA REGISTRY
// =============================================================================

/**
 * All schemas in the application.
 * Used for database initialization.
 */
export const schemas = {
  todos: Todo,
  projects: Project,
} as const

/**
 * Generate all SQL for creating tables.
 */
export function generateAllSchemaSql(): string {
  return Object.values(schemas)
    .map(schema => schema.toSql())
    .join('\n\n')
}

// =============================================================================
// HELPER TYPES
// =============================================================================

/**
 * Union of all schema names.
 */
export type SchemaName = keyof typeof schemas

/**
 * Get the schema type by name.
 */
export type GetSchema<N extends SchemaName> = (typeof schemas)[N]

/**
 * Get the data type for a schema by name.
 */
export type GetSchemaData<N extends SchemaName> = InferShape<
  (typeof schemas)[N]['shape']
>
