// Typefaces printed on the pedals, one character per maker (self-hosted through @fontsource, no network).
import "@fontsource/archivo-narrow/700.css";
import "@fontsource/racing-sans-one/400.css";
import "@fontsource/russo-one/400.css";
import "@fontsource/yellowtail/400.css";
import "@fontsource/oswald/700.css";
import "@fontsource/playfair-display/800-italic.css";
import "@fontsource/lobster/400.css";
import "@fontsource/cinzel/800.css";
import "@fontsource/pacifico/400.css";
import "@fontsource/josefin-sans/700.css";
import "@fontsource/cormorant-garamond/700-italic.css";
import "@fontsource/black-ops-one/400.css";

export const PEDAL_FONT = {
  boss: "'Archivo Narrow', 'Arial Narrow', sans-serif",
  screamer: "'Racing Sans One', 'Archivo Narrow', sans-serif",
  mxr: "'Russo One', sans-serif",
  phase: "'Yellowtail', cursive",
  rat: "'Oswald', 'Archivo Narrow', sans-serif",
  fuzz: "'Playfair Display', serif",
  wah: "'Lobster', cursive",
  bender: "'Cinzel', serif",
  script: "'Pacifico', cursive",
  keeley: "'Cormorant Garamond', serif",
  stencil: "'Black Ops One', sans-serif",
  boutique: "'Josefin Sans', sans-serif",
} as const;
