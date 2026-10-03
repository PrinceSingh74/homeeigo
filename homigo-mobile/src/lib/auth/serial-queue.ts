/**
 * Runs async operations strictly one after another, in call order. Import-free so the bun logic
 * suite can use it directly.
 *
 * Used for the SecureStore refresh-token writes: a rotation write that started before a logout
 * must never land after that logout's clear.
 */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function serial<T>(op: () => Promise<T>): Promise<T> {
    const next = tail.then(op, op);
    tail = next.catch(() => undefined);
    return next;
  };
}
