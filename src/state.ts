import type { ParsedSong } from "./parser/lacuerda";

export type SongState = {
  id: string;
  parsed: ParsedSong;
  offset: number;
  url: string;
};

const songs = new Map<string, SongState>();

export function createSong(parsed: ParsedSong, url: string, offset = 0): SongState {
  const state = { id: crypto.randomUUID(), parsed, offset, url };
  songs.set(state.id, state);
  return state;
}

export function getSong(id: string): SongState | undefined {
  return songs.get(id);
}

export function transposeSong(id: string, delta: number): SongState | undefined {
  const state = songs.get(id);
  if (!state) return undefined;
  state.offset += delta;
  return state;
}

export function resetSong(id: string): SongState | undefined {
  const state = songs.get(id);
  if (!state) return undefined;
  state.offset = 0;
  return state;
}
