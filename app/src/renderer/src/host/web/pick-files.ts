/** Open the browser's file picker; resolves with the chosen files ([] when cancelled). */
export function pickFiles(accept: string, opts: { multiple?: boolean; directory?: boolean } = {}): Promise<File[]> {
  const { promise, resolve } = Promise.withResolvers<File[]>();
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.multiple = opts.multiple ?? false;
  if (opts.directory) input.webkitdirectory = true;
  input.addEventListener("change", () => resolve(Array.from(input.files ?? [])), { once: true });
  input.addEventListener("cancel", () => resolve([]), { once: true });
  input.click();
  return promise;
}
