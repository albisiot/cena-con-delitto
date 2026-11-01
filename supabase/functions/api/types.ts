export type Queryable = {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
};

export type Db = Queryable & {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
};
