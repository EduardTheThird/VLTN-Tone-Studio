import { keyOfSong, type KeyInput } from "./key";
self.onmessage = (event: MessageEvent<KeyInput>) => {
  try {
    self.postMessage({ estimate: keyOfSong(event.data) });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
