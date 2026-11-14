/** The version endpoints of one game (hero_arena or hero_cards); the game is never assumed. */
export const versionPaths = (gameId: string) => ({
  list: `/v1/versions/${gameId}`,
  detail: (hash: string) => `/v1/versions/${gameId}/${encodeURIComponent(hash)}`,
  approve: (hash: string) => `/v1/versions/${gameId}/${encodeURIComponent(hash)}/approve`,
  select: `/v1/data/${gameId}/select`,
});
