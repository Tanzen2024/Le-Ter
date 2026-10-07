import { KeyedSerialQueue } from '../../../src/utils/keyed-serial-queue';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** Laisse s'exécuter toutes les micro-tâches en attente. */
const flush = () => new Promise<void>((r) => setImmediate(r));

describe('KeyedSerialQueue', () => {
  it("exécute les tâches d'une même clé dans l'ordre, une à la fois", async () => {
    const queue = new KeyedSerialQueue<string>();
    const order: string[] = [];
    const gate = deferred();

    const first = queue.run('A', async () => {
      order.push('A1:start');
      await gate.promise;
      order.push('A1:end');
    });
    const second = queue.run('A', async () => {
      order.push('A2');
    });

    await flush();
    expect(order).toEqual(['A1:start']);
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(['A1:start', 'A1:end', 'A2']);
  });

  it('une clé bloquée ne bloque pas les autres clés', async () => {
    const queue = new KeyedSerialQueue<string>();
    const gate = deferred();
    const blockedA = queue.run('A', () => gate.promise);

    await expect(queue.run('B', async () => 'B done')).resolves.toBe('B done');

    gate.resolve();
    await blockedA;
  });

  it("l'échec d'une tâche n'empêche pas les suivantes de la même clé", async () => {
    const queue = new KeyedSerialQueue<string>();

    const failing = queue.run('A', async () => {
      throw new Error('boom');
    });
    const next = queue.run('A', async () => 'ok');

    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });

  it('libère la clé quand la file est vide', async () => {
    const queue = new KeyedSerialQueue<string>();
    await queue.run('A', async () => undefined);
    await flush();
    expect(queue.activeKeys).toBe(0);
  });
});
