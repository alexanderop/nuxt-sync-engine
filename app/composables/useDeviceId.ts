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

  // Use Nuxt's useState for SSR-safe state
  const deviceId = useState<string>('deviceId', () => {
    // Only run on client side
    if (import.meta.client) {
      let id = localStorage.getItem(deviceIdKey)
      if (!id) {
        // Generate a new UUID
        id = crypto.randomUUID()
        localStorage.setItem(deviceIdKey, id)
        console.info('[device] Generated new device ID:', `${id.slice(0, 8)}...`)
      }
      return id
    }
    // Return empty string on server (will be hydrated on client)
    return ''
  })

  // Ensure device ID is set on client mount
  onMounted(() => {
    if (!deviceId.value) {
      let id = localStorage.getItem(deviceIdKey)
      if (!id) {
        id = crypto.randomUUID()
        localStorage.setItem(deviceIdKey, id)
      }
      deviceId.value = id
    }
  })

  return deviceId
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
