/**
 * Whether the presenter starts a bot run by itself when #/present opens. Never on a live server unless ?auto=1 is set
 * (video recording): in front of an audience a hidden run would collide with the dashboard's (RATE_LIMITED) and spend
 * model calls. Otherwise it shows the last stored result and a new run starts only on R or the "Run live" button.
 * ?mock=1 has no server, so its sample run may play on its own.
 */
export function shouldStartOnMount(opts: { auto: boolean; mock: boolean }): boolean {
  return opts.auto || opts.mock;
}
