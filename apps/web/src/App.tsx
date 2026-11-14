import { useRoute } from "./lib/router";
import { Launcher } from "./screens/Launcher";
import { Lobby } from "./screens/Lobby";
import { Controller } from "./screens/Controller";

export function App() {
  const route = useRoute();
  const [screen] = route.path;
  switch (screen) {
    case "play":
    case "join":
      return <Controller key={location.hash} initialCode={route.query.get("code") ?? ""} />;
    case "lobby":
      return <Lobby gameId={route.path[1] ?? "hero_arena"} />;
    default:
      return <Launcher />;
  }
}
