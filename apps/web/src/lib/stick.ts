/** Touch travel (as a share of the stick's radius) below which the stick reads as centred. */
export const DEAD_ZONE = 0.12;
/** Travel at which the hero moves at full speed. */
export const FULL_SPEED = 0.7;

/**
 * Stick response: nothing inside the dead zone, then a linear ramp from 0 to full speed at 70% of the radius, and full
 * speed beyond. Direction is kept as it is. (dx, dy) and `radius` are in the same unit (pixels); the result is -1..1.
 */
export function stickVector(dx: number, dy: number, radius: number): [number, number] {
  const m = Math.hypot(dx, dy) / radius;
  if (m < DEAD_ZONE) return [0, 0];
  const speed = Math.min(1, (m - DEAD_ZONE) / (FULL_SPEED - DEAD_ZONE));
  const len = Math.hypot(dx, dy);
  return [(dx / len) * speed, (dy / len) * speed];
}
