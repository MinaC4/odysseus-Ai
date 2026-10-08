// The migrated pages now use Odysseus sessions and its own persistent database.
class Query implements PromiseLike<any> {
  private query: any = { action: 'select', columns: '*', filters: [], orders: [] };
  private signal?: AbortSignal;
  constructor(private collection: string) {}
  select(columns = '*') { this.query.columns = columns; return this; }
  eq(field: string, value: unknown) { this.query.filters.push({ field, value, op: 'eq' }); return this; }
  in(field: string, value: unknown[]) { this.query.filters.push({ field, value, op: 'in' }); return this; }
  gte(field: string, value: unknown) { this.query.filters.push({ field, value, op: 'gte' }); return this; }
  lte(field: string, value: unknown) { this.query.filters.push({ field, value, op: 'lte' }); return this; }
  not(field: string, operator: string, value: unknown) {
    if(operator!=='is'||value!==null)throw new Error('Unsupported workspace filter');
    this.query.filters.push({field,op:'not_null'});return this;
  }
  order(field: string, options: any = {}) { this.query.orders.push({ field, ascending: options.ascending !== false, nullsFirst: options.nullsFirst }); return this; }
  range(start: number, end: number) { this.query.offset = start; this.query.limit = end - start + 1; return this; }
  limit(value: number) { this.query.limit = value; return this; }
  single() { this.query.single = 'required'; return this; }
  maybeSingle() { this.query.single = 'optional'; return this; }
  abortSignal(signal: AbortSignal) { this.signal = signal; return this; }
  insert(values: unknown) { this.query.action = 'insert'; this.query.values = values; return this; }
  upsert(values: unknown, _options?: unknown) { this.query.action = 'upsert'; this.query.values = values; return this; }
  update(values: unknown) { this.query.action = 'update'; this.query.values = values; return this; }
  delete() { this.query.action = 'delete'; return this; }
  async execute() {
    try {
      const response = await fetch(`/api/productivity/${encodeURIComponent(this.collection)}/query`, {
        method: 'POST', credentials: 'same-origin', signal: this.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.query),
      });
      const result = await response.json();
      if (!response.ok) return { data: null, error: { message: result.detail ?? 'Workspace request failed' } };
      return result;
    } catch (error) { return { data: null, error: { message: error instanceof Error ? error.message : 'Workspace disconnected' } }; }
  }
  then<TResult1 = any, TResult2 = never>(resolve?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): Promise<TResult1 | TResult2> {
    return this.execute().then(resolve, reject);
  }
}
export const supabase = { from: (collection: string) => new Query(collection) };
