import { Suspense, lazy } from "react";
import { useRoute } from "./lib/router";
import { Controller } from "./screens/Controller";
import { isAutoMode } from "./lib/presenter";

// Every screen except the phone controller is its own chunk, so a phone joining over a slow link loads the controller
// and nothing else (the big screen's Phaser scene, the QR code, charts and stored runs stay on the server).
const Launcher = lazy(() => import("./screens/Launcher").then((m) => ({ default: m.Launcher })));
const Lobby = lazy(() => import("./screens/Lobby").then((m) => ({ default: m.Lobby })));
const Arena = lazy(() => import("./screens/Arena").then((m) => ({ default: m.Arena })));
const Dashboard = lazy(() => import("./screens/Dashboard").then((m) => ({ default: m.Dashboard })));
const Versions = lazy(() => import("./screens/Versions").then((m) => ({ default: m.Versions })));
const Intent = lazy(() => import("./screens/Intent").then((m) => ({ default: m.Intent })));
const Skill = lazy(() => import("./screens/Skill").then((m) => ({ default: m.Skill })));
const Present = lazy(() => import("./screens/Present").then((m) => ({ default: m.Present })));

function Loading() {
  return (
    <main className="boundary" aria-busy="true">
      <p className="small text-2">Loading…</p>
    </main>
  );
}

export function App() {
  const route = useRoute();
  const [screen] = route.path;
  if (screen === "play" || screen === "join") {
    return <Controller key={location.hash} initialCode={route.query.get("code") ?? ""} />;
  }
  return <Suspense fallback={<Loading />}>{screenFor(screen, route)}</Suspense>;
}

function screenFor(screen: string | undefined, route: ReturnType<typeof useRoute>) {
  switch (screen) {
    case "arena":
      return <Arena gameId={route.path[1] ?? "hero_arena"} />;
    case "present":
      return <Present auto={isAutoMode(route.query)} />;
    case "intent":
      return <Intent />;
    case "skill":
      return <Skill />;
    case "versions":
      return <Versions />;
    case "dashboard":
      return <Dashboard />;
    case "lobby":
      return <Lobby gameId={route.path[1] ?? "hero_arena"} dataHash={route.query.get("hash") ?? undefined} />;
    default:
      return <Launcher />;
  }
}
