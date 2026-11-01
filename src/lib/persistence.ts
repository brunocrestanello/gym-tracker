// FIFO queues preserve edit order, including operations delayed before IndexedDB.
// A row's fields and deletion share a queue. Failures do not stop later retries.
const pending = new Set<Promise<unknown>>();
const failures = new Map<string, unknown>();
const revisions = new Map<string, number>();
const tails = new Map<string, Promise<unknown>>();

export function persist<T>(key: string, operation: () => Promise<T>, queue = key): Promise<T> {
  const revision = (revisions.get(key) ?? 0) + 1;
  revisions.set(key, revision);
  const previous = tails.get(queue) ?? Promise.resolve();
  const promise = previous.catch(() => {}).then(operation);
  tails.set(queue, promise);
  pending.add(promise);
  const complete = () => {
    pending.delete(promise);
    if (tails.get(queue) === promise) tails.delete(queue);
  };
  promise.then(() => {
    complete();
    if (revisions.get(key) === revision) failures.delete(key);
  }, error => {
    complete();
    if (revisions.get(key) === revision) failures.set(key, error);
  });
  return promise;
}

/** Only after a successful, intentional row deletion, following that row's queued writes. */
export function forgetDeletedSetFailures(id: string): void {
  for (const field of ["weight", "reps", "rir"]) failures.delete(`${id}:${field}`);
}

export function hasUnsavedWrites(): boolean {
  return pending.size > 0 || failures.size > 0;
}

export async function waitForWrites(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
  if (failures.size) throw new Error("Hay cambios sin guardar. Corregí los campos o reintentá antes de continuar.");
}
