import { Button } from '@/components/ui/button';
import { connectBluetooth, useBluetooth } from './connection';
import { useDevice } from '@/state/device';

export function BluetoothControls({ editor = false }: { editor?: boolean }) {
  const { connection, connecting, error } = useBluetooth();
  const status = useDevice(s => s.status), mode = useDevice(s => s.mode), busy = useDevice(s => s.busy);
  return <div className="flex max-w-xl flex-col gap-2 text-sm">
    <div className="flex flex-wrap items-center gap-2">
      {!connection ? <Button variant="outline" disabled={connecting} onClick={() => void connectBluetooth().catch(() => {})}>{connecting ? 'Selecting Bluetooth device…' : 'Connect Bluetooth MIDI'}</Button> : <>
        <span>Bluetooth: {connection.name}</span>
        <Button variant="outline" disabled={status === 'connecting' || !!busy} onClick={() => { if (mode === 'bluetooth') void useDevice.getState().disconnect(); else connection.close(); }}>Disconnect Bluetooth</Button>
      </>}
    </div>
    {editor && <p className="text-silkscreen-3">Bluetooth MIDI is available for performance controls. Connect by USB to manage and edit the pedal; Bluetooth editor management is disabled.</p>}
    {error && <p role="alert" className="text-red-400">{error}</p>}
  </div>;
}
