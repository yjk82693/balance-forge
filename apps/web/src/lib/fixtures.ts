// Read-only imports from the shared fixtures/ folder (owned by main).
import wsMessages from "../../../../fixtures/ws_messages.json";
import observation from "../../../../fixtures/observation.json";
import reportBaseline from "../../../../fixtures/report_baseline.json";
import reportPatched from "../../../../fixtures/report_patched.json";
import patchProposal from "../../../../fixtures/patch_proposal.json";
import matchResults from "../../../../fixtures/match_results.json";
import matchConfig from "../../../../fixtures/match_config.json";
import type {
  Envelope,
  MatchConfig,
  MatchResult,
  Observation,
  PatchProposal,
  Report,
  RoomStatusPayload,
} from "./contract";

const messages = wsMessages as unknown as Envelope[];
const byType = (t: string) => messages.find((m) => m.type === t)!;

export const fixtureRoomStatus = byType("room.status") as Envelope<RoomStatusPayload>;
export const fixtureInputSubmit = byType("input.submit") as Envelope<{
  actionId: string; params: Record<string,
  number>,
}>;
export const fixtureInputAck = byType("input.ack") as Envelope<{ status: string; acceptedTick: number }>;
export const fixtureStateView = byType("state.view") as Envelope<{ observation: Observation; viewHash: string }>;
export const fixtureMatchEnded = byType("match.ended") as Envelope<{ result: MatchResult }>;

export const fixtureObservation = observation as unknown as Observation;
export const fixtureReportBaseline = reportBaseline as unknown as Report;
export const fixtureReportPatched = reportPatched as unknown as Report;
export const fixturePatch = patchProposal as unknown as PatchProposal;
export const fixtureMatchResults = matchResults as unknown as MatchResult[];
export const fixtureMatchConfig = matchConfig as unknown as MatchConfig;
