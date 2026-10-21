// The NAM render kernels as the app bundles them (Vite `?url` assets), for the Web Workers that render captures.
import a1KernelUrl from "./a1kernel.wasm?url";
import a2KernelUrl from "./a2kernel.wasm?url";

/** The wasm kernel for a model family; a KernelSource (pipeline.ts) for workers. */
export async function fetchKernel(arch: "A1" | "A2"): Promise<ArrayBuffer> {
  const res = await fetch(arch === "A2" ? a2KernelUrl : a1KernelUrl);
  if (!res.ok) throw new Error(`Couldn't load the SnapTone converter (${res.status})`);
  return res.arrayBuffer();
}
