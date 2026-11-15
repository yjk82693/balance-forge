import { integer as int, text, array, object, ref } from '../../contracts/shapes.ts';

const coord = int(-100000, 10000000);
export const actions = [
  { actionId: 'control', labelKey: 'action.control', control: 'axes',
    paramsSchema: object({ jump: int(0, 1), slide: int(0, 1) }) }
];
const section = object({ length: int(6000, 100000), pits: int(0, 12), lowBars: int(0, 12), walls: int(0, 8),
  anchorSpacing: int(1000, 40000), runSpeed: int(10, 80), flaw: text(200) },
['length', 'pits', 'lowBars', 'walls', 'anchorSpacing', 'runSpeed']);
const obstacle = object({ id: text(), kind: { enum: ['pit', 'lowBar', 'wall'] }, x: coord, w: int(1, 100000), y: coord,
  h: int(0, 100000), section: int(1, 6) });
const anchor = object({ id: text(), x: coord, y: coord, section: int(1, 6), overPit: { type: 'boolean' } });
const wire = { anyOf: [{ type: 'null' }, object({ anchorId: text(), anchorX: coord, anchorY: coord,
  length: int(1, 100000) })] };
const playerState = { enum: ['running', 'jumping', 'sliding', 'swinging'] };
const player = object({ x: coord, y: coord, vx: int(-1000, 1000), vy: int(-1000, 1000), state: playerState,
  height: int(1, 5000), jumpHeldTicks: int(), airTicks: int(), jumpBuffer: int(), jumped: { type: 'boolean' }, wire });
export const schemas = {
  ...Object.fromEntries(actions.map(a => [`action:${a.actionId}`, a.paramsSchema])),
  rules: object({
    viewWidth: { const: 16000 },
    leadIn: int(0, 20000),
    player: object({ width: int(100, 3000), height: int(100, 5000), slideHeight: int(100, 5000) }),
    physics: object({ gravity: int(1, 20), jumpVelocity: int(1, 200), maxFall: int(1, 200), tapTicks: int(1, 60),
      wireRange: int(100, 20000), wireMinLength: int(100, 20000), swingGravity: int(0, 20),
      reelSpeed: int(0, 200), releaseBoost: int(0, 100) }),
    obstacles: object({ pitWidth: int(100, 10000), lowBarWidth: int(100, 10000), lowBarBottom: int(0, 5000),
      lowBarTop: int(0, 8000), wallWidth: int(100, 10000), wallHeight: int(100, 10000),
      anchorHeight: int(1000, 20000) }),
    sections: array(section, 6, 6)
  }),
  state: object({
    config: ref('MatchConfig'),
    input: object({ jump: int(0, 1), slide: int(0, 1) }),
    finishX: int(),
    bounds: array(object({ start: int(), end: int() }), 6, 6),
    obstacles: array(obstacle, 200),
    anchors: array(anchor, 400),
    player,
    outcome: ref('Outcome'),
    statistics: ref('Statistics')
  }),
  observation: object({
    section: int(1, 6),
    sectionCount: { const: 6 },
    sectionStartX: int(), sectionEndX: int(),
    cameraX: int(), viewWidth: { const: 16000 }, finishX: int(),
    player,
    obstacles: array(obstacle, 200),
    anchors: array(anchor, 400),
    shark: { anyOf: [{ type: 'null' }, object({ x: coord })] },
    outcome: ref('Outcome')
  })
};
