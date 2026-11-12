import { BrowserRouter, Route, Routes } from "react-router-dom";
import { DeckProvider } from "./deck/DeckContext";
import Home from "./screens/Home";
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
            <Route path="/build" element={<Placeholder title="Building your deck" arrivesIn="v0.2.0" />} />
            <Route path="/deck" element={<DeckOverview />} />
            <Route path="/player" element={<Placeholder title="Player" arrivesIn="v0.4.0" />} />
            <Route path="/quiz" element={<Placeholder title="Quiz" arrivesIn="v0.5.0" />} />
            <Route path="/results" element={<Placeholder title="Results" arrivesIn="v0.6.0" />} />
            <Route path="*" element={<Placeholder title="Page not found" arrivesIn="never, check the address" />} />
          </Routes>
        </div>
      </BrowserRouter>
    </DeckProvider>
  );
}
