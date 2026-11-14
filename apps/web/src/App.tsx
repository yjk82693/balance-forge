import { useRoute } from "./lib/router";
import { Launcher } from "./screens/Launcher";

export function App() {
  const route = useRoute();
  const [screen] = route.path;
  switch (screen) {
    default:
      return <Launcher />;
  }
}
