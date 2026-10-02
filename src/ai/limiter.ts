/** Counting semaphore with a dynamic limit (read on every acquire). */
export class Limiter {
  private active = 0
  private queue: (() => void)[] = []
  constructor(private max: () => number) {}

  acquire(): Promise<void> {
    if (this.active < Math.max(1, this.max())) {
      this.active++
      return Promise.resolve()
    }
    return new Promise((resolve) =>
      this.queue.push(() => {
        this.active++
        resolve()
      }),
    )
  }

  release() {
    this.active = Math.max(0, this.active - 1)
    while (this.queue.length && this.active < Math.max(1, this.max())) this.queue.shift()!()
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }
}
