import { expect, it } from 'vitest';
import { songSaveFilters } from './song-save-options';
it('exports charts with their text extension and preserves WAV audio exports', () => {
  expect(songSaveFilters('performance.lrc')[0].extensions).toEqual(['lrc']);
  expect(songSaveFilters('estimated-chords.LRC')[0].extensions).toEqual(['lrc']);
  expect(songSaveFilters('guitar.wav')[0].extensions).toEqual(['wav']);
});
