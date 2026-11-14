import { BOT_SKILLS, availableSkills, type BotSkill } from "../lib/botPolicy";

interface Props {
  value: BotSkill;
  onChange: (skill: BotSkill) => void;
  disabled?: boolean;
}

/** Which bots play: Scripted (default), Trained (self-play) once trained, Human-style once its model exists. */
export function BotSkillPicker({ value, onChange, disabled }: Props) {
  const offered = availableSkills();
  const only = offered.length === 1;
  return (
    <label
      className="small matchup-side"
      title={only ? "No trained bots yet: only the scripted bot is available." : "Which bots play"}
    >
      <span className="sr-only">Bot skill</span>
      <select
        className="select"
        value={value}
        disabled={disabled || only}
        onChange={(e) => onChange(e.target.value as BotSkill)}
      >
        {BOT_SKILLS.filter((s) => offered.includes(s.id)).map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );
}
