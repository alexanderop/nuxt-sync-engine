import { $fetch, setup } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'

describe('sync API', async () => {
  await setup({ server: true })

  it('gET /api/sync/pull returns changes', async () => {
    const res = await $fetch('/api/sync/pull', {
      query: { schema: 'todos', since: 0, deviceId: 'test' },
    })
    expect(res).toHaveProperty('changes')
    expect(res).toHaveProperty('syncedAt')
  })

  it('pOST /api/sync/push stores items', async () => {
    const res = await $fetch('/api/sync/push', {
      method: 'POST',
      body: {
        schema: 'todos',
        changes: [{
          id: `test-${Date.now()}`,
          data: { text: 'Test', completed: false },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          deviceId: 'test',
          deleted: false,
        }],
      },
    })
    expect(res.stored).toBe(1)
  })
})
