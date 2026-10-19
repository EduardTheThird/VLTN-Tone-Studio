// Zoom of the pedal board on top of the automatic fit (100% = every pedal of the group fits; the +/- bar beside it), remembered between launches (localStorage; every access survives missing storage).
import { create } from "zustand";

const KEY = "gp5.rigZoom.v2";
export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 2;
export const ZOOM_STEP = 0.1;

const clamp = (z: number) => Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 100) / 100;

function load(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v > 0 ? clamp(v) : 1;
  } catch {
    return 1;
  }
}

export const useBoardZoom = create<{ zoom: number; setZoom(z: number): void }>((set) => ({
  zoom: load(),
  setZoom: (z) => {
    const zoom = clamp(z);
    set({ zoom });
    try {
      localStorage.setItem(KEY, String(zoom));
    } catch {
      /* storage unavailable: the zoom resets next launch */
    }
  },
}));
