/** Stable Electron storage and log locations across the DobeeWork display-name change. */
import { join } from 'node:path'

const LEGACY_DESKTOP_DIRECTORY = 'DeepSeek Harness'

/**
 * Retain the existing desktop browser storage without moving user files.
 * @param appData - Electron's platform-specific application-data root.
 * @returns the existing desktop userData directory.
 */
export function dobeeDesktopUserDataPath(appData: string): string {
  return join(appData, LEGACY_DESKTOP_DIRECTORY)
}

/**
 * Retain the existing macOS crash-report directory across display-name changes.
 * @param home - Electron's account home directory.
 * @returns the existing macOS application logs directory.
 */
export function dobeeDesktopLogsPath(home: string): string {
  return join(home, 'Library', 'Logs', LEGACY_DESKTOP_DIRECTORY)
}
