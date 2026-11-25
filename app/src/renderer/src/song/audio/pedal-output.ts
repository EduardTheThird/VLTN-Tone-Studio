import { isPedalInput, listInputs } from "@/song/tonematch/recorder";

export function findPedalOutput<T extends { label: string; deviceId: string }>(
  outputs: readonly T[],
  model?: "gp150" | "gp180",
): T | null {
  if (!model) return outputs.find((device) => isPedalInput(device.label)) ?? null;
  const named = outputs.filter(({ deviceId }) => deviceId && deviceId !== "default" && deviceId !== "communications");
  const modelLabel = model === "gp150" ? /\bGP[ -]?150\b/i : /\bGP[ -]?180\b/i;
  const exact = named.filter(({ label }) => modelLabel.test(label));
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  const generic = named.filter(({ label }) => /valeton/i.test(label) && !/\bGP[ -]?\d/i.test(label));
  return generic.length === 1 ? generic[0] : null;
}

/** The pedal's USB sound card among the audio outputs, when it is plugged in. */
export async function pedalOutput(): Promise<MediaDeviceInfo | null> {
  try {
    await listInputs(); // asks for the microphone permission once, which is what unlocks device names
    const outputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput");
    return findPedalOutput(outputs);
  } catch {
    return null;
  }
}
