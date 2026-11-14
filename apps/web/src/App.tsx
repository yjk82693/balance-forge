import { useRoute } from "./lib/router";
import { Launcher } from "./screens/Launcher";
import { Lobby } from "./screens/Lobby";
import { Arena } from "./screens/Arena";
import { Dashboard } from "./screens/Dashboard";
import { Controller } from "./screens/Controller";
import { Present } from "./screens/Present";
import { Versions } from "./screens/Versions";
import { isAutoMode } from "./lib/presenter";

export function App() {
  const route = useRoute();
  const [screen] = route.path;
  switch (screen) {
    case "play":
    case "join":
      return <Controller key={location.hash} initialCode={route.query.get("code") ?? ""} />;
    case "arena":
      return <Arena gameId={route.path[1] ?? "hero_arena"} />;
    case "present":
      return <Present auto={isAutoMode(route.query)} />;
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
