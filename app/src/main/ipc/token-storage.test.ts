import type { SafeStorage } from "electron";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { secureTokenStore, tokenEncryptionAvailable } from "./token-storage";

describe("tokenEncryptionAvailable", () => {
  it("trusts safeStorage on macOS and Windows", () => {
    expect(tokenEncryptionAvailable({ platform: "darwin", encryptionAvailable: true, backend: null })).toBe(true);
    expect(tokenEncryptionAvailable({ platform: "win32", encryptionAvailable: true, backend: null })).toBe(true);
  });

  it("trusts a real Linux keyring", () => {
    for (const backend of ["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"]) {
      expect(tokenEncryptionAvailable({ platform: "linux", encryptionAvailable: true, backend })).toBe(true);
    }
  });

  it("treats the Linux basic_text fallback as no encryption", () => {
    expect(tokenEncryptionAvailable({ platform: "linux", encryptionAvailable: true, backend: "basic_text" })).toBe(false);
  });

  it("is unavailable when safeStorage reports so", () => {
    expect(tokenEncryptionAvailable({ platform: "darwin", encryptionAvailable: false, backend: null })).toBe(false);
    expect(tokenEncryptionAvailable({ platform: "linux", encryptionAvailable: false, backend: "unknown" })).toBe(false);
  });
});

it("opens a fresh profile without Keychain and reads an existing token asynchronously", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vltn-token-test-"));
  const file = join(dir, "token.enc");
  const mock = {
    isEncryptionAvailable: vi.fn(),
    decryptString: vi.fn(),
    decryptStringAsync: vi.fn(async () => ({ result: JSON.stringify({ access_token: "fixture", refresh_token: "fixture-refresh", expires_at: 10000 }), shouldReEncrypt: false })),
  };
  try {
    const store = secureTokenStore(() => file, mock as unknown as SafeStorage, "darwin");
    expect(await store.load()).toBeNull();
    expect(mock.decryptStringAsync).not.toHaveBeenCalled();
    await writeFile(file, "encrypted fixture");
    expect(await store.load()).toEqual({ access_token: "fixture", refresh_token: "fixture-refresh", expires_at: 10000 });
    expect(mock.decryptStringAsync).toHaveBeenCalledOnce();
    expect(mock.isEncryptionAvailable).not.toHaveBeenCalled();
    expect(mock.decryptString).not.toHaveBeenCalled();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
