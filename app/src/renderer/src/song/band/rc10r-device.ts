import { useEffect, useState } from "react";

const matches = (name: string | null) => /^(?:BOSS)?RC10R(?:MIDI)?$/.test((name ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""));

/** Enumeration never opens a port or sends a message. Transfer rechecks the same exact pairing before acquiring it. */
export function rc10rPorts(access: MIDIAccess): { inputs: MIDIInput[]; outputs: MIDIOutput[] } {
  return {
    inputs: [...access.inputs.values()].filter((port) => port.state === "connected" && matches(port.name)),
    outputs: [...access.outputs.values()].filter((port) => port.state === "connected" && matches(port.name)),
  };
}

export interface Rc10rDeviceState {
  connected: boolean;
  message: string;
}

/** Watches hot-plug events only on a desktop host that supports native storage transfer. */
export function useRc10rDevice(enabled: boolean): Rc10rDeviceState {
  const [state, setState] = useState<Rc10rDeviceState>({ connected: false, message: "Checking for RC-10R USB MIDI…" });
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let access: MIDIAccess | undefined;
    const update = () => {
      if (disposed || !access) return;
      const { inputs, outputs } = rc10rPorts(access);
      const connected = inputs.length === 1 && outputs.length === 1;
      setState({
        connected,
        message: connected
          ? "RC-10R connected — native sending available."
          : inputs.length > 1 || outputs.length > 1
            ? "More than one RC-10R MIDI port is connected. Keep one input and output connected."
            : "Connect the RC-10R by USB to enable native sending.",
      });
    };
    void Promise.resolve()
      .then(() => navigator.requestMIDIAccess({ sysex: true }))
      .then((result) => {
        if (disposed) return;
        access = result;
        access.addEventListener("statechange", update);
        update();
      })
      .catch(() => {
        if (!disposed) setState({ connected: false, message: "Allow MIDI access and reopen this dialog to detect the RC-10R." });
      });
    return () => {
      disposed = true;
      access?.removeEventListener("statechange", update);
    };
  }, [enabled]);
  return state;
}
