declare module 'sql.js' {
  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | null) => Database
  }

  export interface Database {
    run: (sql: string, params?: unknown[]) => void
    exec: (sql: string) => QueryExecResult[]
    prepare: (sql: string) => Statement
    export: () => Uint8Array<ArrayBuffer>
    close: () => void
  }

  export interface Statement {
    bind: (params?: unknown[]) => boolean
    step: () => boolean
    getAsObject: () => Record<string, unknown>
    free: () => void
  }

  export interface QueryExecResult {
    columns: string[]
    values: unknown[][]
  }

  export interface SqlJsConfig {
    locateFile?: (file: string) => string
  }

  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>
}
