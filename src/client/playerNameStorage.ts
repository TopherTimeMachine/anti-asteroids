const PLAYER_NAME_STORAGE_KEY = 'anti-asteroids-player-name';
const MAX_PLAYER_NAME_LENGTH = 12;

export function getSavedPlayerName(): string | null {
  try {
    const name = localStorage.getItem(PLAYER_NAME_STORAGE_KEY)?.trim();
    if (!name) return null;
    return name.slice(0, MAX_PLAYER_NAME_LENGTH);
  } catch {
    return null;
  }
}

export function savePlayerName(name: string): void {
  const trimmed = name.trim().slice(0, MAX_PLAYER_NAME_LENGTH);
  if (!trimmed) return;
  try {
    localStorage.setItem(PLAYER_NAME_STORAGE_KEY, trimmed);
  } catch {
    // Storage may be unavailable in private browsing.
  }
}

export function hasSavedPlayerName(): boolean {
  return getSavedPlayerName() !== null;
}
