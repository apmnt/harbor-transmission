export interface SqliteStatement {
  run: (...params: unknown[]) => unknown
  get: (...params: unknown[]) => Record<string, unknown> | undefined
  all: (...params: unknown[]) => Record<string, unknown>[]
}

export interface SqliteDatabase {
  exec: (sql: string) => void
  prepare: (sql: string) => SqliteStatement
  close: () => void
}

function isBunRuntime() {
  return typeof globalThis === 'object' && globalThis !== null && 'Bun' in globalThis
}

function createStatementAdapter(statement: {
  run: (...params: unknown[]) => unknown
  get: (...params: unknown[]) => Record<string, unknown> | undefined
  all: (...params: unknown[]) => Record<string, unknown>[]
}): SqliteStatement {
  return {
    run: (...params) => statement.run(...params),
    get: (...params) => statement.get(...params),
    all: (...params) => statement.all(...params),
  }
}

export async function openSqliteDatabase(path: string): Promise<SqliteDatabase> {
  if (isBunRuntime()) {
    const bunSqliteModuleName = 'bun:sqlite'
    const bunSqliteModule = (await import(bunSqliteModuleName)) as {
      Database: new (path: string) => {
        close: () => void
        exec: (sql: string) => void
        query: (sql: string) => {
          run: (...params: unknown[]) => unknown
          get: (...params: unknown[]) => Record<string, unknown> | undefined
          all: (...params: unknown[]) => Record<string, unknown>[]
        }
      }
    }

    const database = new bunSqliteModule.Database(path)

    return {
      close: () => database.close(),
      exec: (sql) => database.exec(sql),
      prepare: (sql) => createStatementAdapter(database.query(sql)),
    }
  }

  const nodeSqliteModuleName = 'node:sqlite'
  const nodeSqliteModule = (await import(nodeSqliteModuleName)) as {
    DatabaseSync: new (path: string) => {
      close: () => void
      exec: (sql: string) => void
      prepare: (sql: string) => {
        run: (...params: unknown[]) => unknown
        get: (...params: unknown[]) => Record<string, unknown> | undefined
        all: (...params: unknown[]) => Record<string, unknown>[]
      }
    }
  }

  const database = new nodeSqliteModule.DatabaseSync(path)

  return {
    close: () => database.close(),
    exec: (sql) => database.exec(sql),
    prepare: (sql) => createStatementAdapter(database.prepare(sql)),
  }
}
