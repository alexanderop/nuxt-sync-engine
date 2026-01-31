/**
 * Device ID Composable
 * ====================
 *
 * Generates and persists a unique device identifier.
 * This is used to track which device made each change.
 *
 * > **What Jazz Does Better**
 * >
 * > Jazz uses cryptographic identities:
 * > - Each device has a keypair
 * > - Changes are signed with the private key
 * > - Identity is verifiable without trusting the server
 * >
 * > We use a simple UUID stored in localStorage.
 */

import { useLocalStorage } from '@vueuse/core'

/**
 * Composable for managing device identity.
 *
 * @example
 * ```typescript
 * const deviceId = useDeviceId();
 * console.log(deviceId.value); // "550e8400-e29b-41d4-a716-446655440000"
 * ```
 */
export function useDeviceId() {
  const appConfig = useAppConfig()
  const deviceIdKey = appConfig.storage.deviceIdKey

  const deviceId = useLocalStorage(deviceIdKey, '', {
    initOnMounted: true,
  })

  // Generate ID if empty (first visit)
  onMounted(() => {
    if (!deviceId.value) {
      deviceId.value = crypto.randomUUID()
      console.info('[device] Generated new device ID:', `${deviceId.value.slice(0, 8)}...`)
    }
  })

  return readonly(deviceId)
}

/**
 * Get the device ID synchronously (for non-reactive contexts).
 * Only call this on the client side.
 */
export function getDeviceId(): string {
  if (import.meta.server) {
    throw new Error('getDeviceId() can only be called on the client')
  }

  const appConfig = useAppConfig()
  const deviceIdKey = appConfig.storage.deviceIdKey

  let id = localStorage.getItem(deviceIdKey)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(deviceIdKey, id)
  }
  return id
}

/**
 * Reset the device ID (useful for testing).
 */
export function resetDeviceId(): string {
  if (import.meta.server) {
    throw new Error('resetDeviceId() can only be called on the client')
  }

  const appConfig = useAppConfig()
  const deviceIdKey = appConfig.storage.deviceIdKey

  const id = crypto.randomUUID()
  localStorage.setItem(deviceIdKey, id)
  return id
}
