/**
 * Storage Quota Composable
 * ========================
 *
 * Monitors IndexedDB storage quota and provides persistence requests.
 * Uses VueUse's useSupported for SSR-safe feature detection.
 *
 * > **Storage Quota API**
 * >
 * > The Storage API provides methods to:
 * > - Estimate storage usage and quota
 * > - Request persistent storage (prevents browser from evicting data)
 */

import type { ComputedRef, Ref } from 'vue'

import { useSupported } from '@vueuse/core'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Storage quota information from navigator.storage.estimate()
 */
export interface StorageQuota {
  /** Current usage in bytes */
  usage: number
  /** Total quota available in bytes */
  quota: number
}

/**
 * Return type for the useStorageQuota composable.
 */
export interface UseStorageQuotaReturn {
  /** Whether the storage estimate API is supported */
  isSupported: ComputedRef<boolean>
  /** Whether the persist API is supported */
  isPersistSupported: ComputedRef<boolean>
  /** Current storage quota information (null until checked) */
  quota: Ref<StorageQuota | null>
  /** Whether storage usage exceeds 90% of quota */
  isLowStorage: ComputedRef<boolean>
  /** Check and update storage quota */
  checkQuota: () => Promise<void>
  /** Request persistent storage (returns true if granted) */
  requestPersistence: () => Promise<boolean>
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Threshold for low storage warning (90%) */
const LOW_STORAGE_THRESHOLD = 0.9

// =============================================================================
// COMPOSABLE
// =============================================================================

/**
 * Storage quota monitoring composable.
 *
 * @example
 * ```typescript
 * const { isSupported, quota, isLowStorage, checkQuota, requestPersistence } = useStorageQuota()
 *
 * // Check quota on mount
 * onMounted(async () => {
 *   await checkQuota()
 *   if (isLowStorage.value) {
 *     console.warn('Storage is running low!')
 *   }
 * })
 *
 * // Request persistent storage
 * const persisted = await requestPersistence()
 * if (persisted) {
 *   console.log('Storage will not be evicted')
 * }
 * ```
 */
export function useStorageQuota(): UseStorageQuotaReturn {
  // SSR-safe feature detection
  const isSupported = useSupported(
    () => 'storage' in navigator && 'estimate' in navigator.storage,
  )

  const isPersistSupported = useSupported(
    () => 'storage' in navigator && 'persist' in navigator.storage,
  )

  // Quota state (initialized to null)
  const quota = ref<StorageQuota | null>(null)

  // Computed: is storage usage above 90%?
  const isLowStorage = computed<boolean>(() => {
    if (!quota.value) {
      return false
    }
    if (quota.value.quota === 0) {
      return false
    }
    return quota.value.usage / quota.value.quota > LOW_STORAGE_THRESHOLD
  })

  /**
   * Check and update storage quota.
   * Only runs if the storage estimate API is supported.
   */
  async function checkQuota(): Promise<void> {
    if (!isSupported.value) {
      return
    }

    try {
      const estimate = await navigator.storage.estimate()
      quota.value = {
        usage: estimate.usage ?? 0,
        quota: estimate.quota ?? 0,
      }
    }
    catch (error) {
      console.error('[storage-quota] Failed to estimate storage:', error)
    }
  }

  /**
   * Request persistent storage.
   * Returns true if persistence was granted, false otherwise.
   */
  async function requestPersistence(): Promise<boolean> {
    if (!isPersistSupported.value) {
      return false
    }

    try {
      const persisted = await navigator.storage.persist()
      return persisted
    }
    catch (error) {
      console.error('[storage-quota] Failed to request persistence:', error)
      return false
    }
  }

  return {
    isSupported,
    isPersistSupported,
    quota,
    isLowStorage,
    checkQuota,
    requestPersistence,
  }
}
