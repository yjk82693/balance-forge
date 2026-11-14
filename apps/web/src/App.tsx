import { useRoute } from "./lib/router";
import { Launcher } from "./screens/Launcher";
import { Lobby } from "./screens/Lobby";

export function App() {
  const route = useRoute();
  const [screen] = route.path;
  switch (screen) {
    case "lobby":
      return <Lobby gameId={route.path[1] ?? "hero_arena"} />;
    default:
      return <Launcher />;
  }
}
