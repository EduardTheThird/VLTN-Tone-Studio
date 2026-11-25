import { readFile, rm, writeFile } from "node:fs/promises";
import type { SafeStorage } from "electron";
import type { TokenSet, TokenStore } from "../tone3000/tokens";

/** What Electron's safeStorage reports about this machine. `backend` is only read on Linux, where it tells a keyring from the fallback. */
export interface SafeStorageState {
  platform: string;
  encryptionAvailable: boolean;
  backend: string | null;
}

/**
 * Whether safeStorage really protects the tokens. On Linux, "basic_text" is the fallback used when no keyring runs.
 * It reports encryption as available but uses a constant key, so it counts as no encryption.
 */
export function tokenEncryptionAvailable(state: SafeStorageState): boolean {
  if (!state.encryptionAvailable) return false;
  return !(state.platform === "linux" && state.backend === "basic_text");
}

export function safeStorageState(storage: SafeStorage, platform: string): SafeStorageState {
  return {
    platform,
    encryptionAvailable: storage.isEncryptionAvailable(),
    backend: platform === "linux" ? storage.getSelectedStorageBackend() : null,
  };
}

/** Uses the OS keychain on disk. With no secure storage the account is kept in memory for this run. */
export function secureTokenStore(path: () => string, storage: SafeStorage, platform: string): TokenStore {
  return {
    async load() {
      const file = path();
      try {
        // A new profile has no secrets to look up. On macOS, opening Keychain can ask for access.
        const encrypted = await readFile(file);
        if (platform !== "linux") {
          const { result } = await storage.decryptStringAsync(encrypted);
          return JSON.parse(result) as TokenSet;
        }
        const state = safeStorageState(storage, platform);
        if (tokenEncryptionAvailable(state)) return JSON.parse(storage.decryptString(encrypted)) as TokenSet;
        // Legacy basic_text files were encrypted with a constant key.
        if (state.backend === "basic_text") await rm(file, { force: true });
        return null;
      } catch {
        return null; // missing, unreadable or from another machine
      }
    },
    async save(tokens) {
      const value = JSON.stringify(tokens);
      if (platform === "linux") {
        if (!tokenEncryptionAvailable(safeStorageState(storage, platform))) return;
        await writeFile(path(), storage.encryptString(value));
      } else if (await storage.isAsyncEncryptionAvailable()) {
        await writeFile(path(), await storage.encryptStringAsync(value));
      }
    },
    async clear() {
      await rm(path(), { force: true });
    },
  };
}
