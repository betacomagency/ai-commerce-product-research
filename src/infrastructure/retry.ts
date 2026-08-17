export async function withRetry<T>(
  operation: () => Promise<T>,
  options: { attempts: number; baseDelayMs?: number; shouldRetry?: (error: unknown) => boolean },
): Promise<T> {
  const totalAttempts = Math.max(1, options.attempts)
  let lastError: unknown

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt === totalAttempts || options.shouldRetry?.(error) === false) break
      const delay = (options.baseDelayMs ?? 350) * (2 ** (attempt - 1))
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError
}
