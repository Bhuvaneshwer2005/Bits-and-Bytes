import { BrowserRouter, Route, Routes } from "react-router-dom";
import { DeckProvider } from "./deck/DeckContext";
import Build from "./screens/Build";
import Home from "./screens/Home";
import OutlineView from "./screens/OutlineView";
import Player from "./screens/Player";
import DeckOverview from "./screens/DeckOverview";
import Placeholder from "./screens/Placeholder";

export default function App() {
  return (
    <DeckProvider>
      <BrowserRouter>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <div className="app">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/build" element={<Build />} />
            <Route path="/outline/:key" element={<OutlineView />} />
            <Route path="/deck" element={<DeckOverview />} />
            <Route path="/player" element={<Player />} />
            <Route path="/quiz" element={<Placeholder title="Quiz" arrivesIn="v0.5.0" />} />
            <Route path="/results" element={<Placeholder title="Results" arrivesIn="v0.6.0" />} />
            <Route path="*" element={<Placeholder title="Page not found" arrivesIn="never, check the address" />} />
          </Routes>
        </div>
      </BrowserRouter>
    </DeckProvider>
  );
}
