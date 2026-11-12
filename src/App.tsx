import { BrowserRouter, Route, Routes } from "react-router-dom";
import { DeckProvider } from "./deck/DeckContext";
import Build from "./screens/Build";
import EditCard from "./screens/EditCard";
import Home from "./screens/Home";
import OutlineView from "./screens/OutlineView";
import Player from "./screens/Player";
import DeckOverview from "./screens/DeckOverview";
import NotFound from "./screens/NotFound";
import OfflineBanner from "./components/OfflineBanner";
import Quiz from "./screens/Quiz";
import Results from "./screens/Results";

export default function App() {
  return (
    <DeckProvider>
      <BrowserRouter>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <div className="app">
          <OfflineBanner />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/build" element={<Build />} />
            <Route path="/outline/:key" element={<OutlineView />} />
            <Route path="/deck" element={<DeckOverview />} />
            <Route path="/player" element={<Player />} />
            <Route path="/edit/:cardId" element={<EditCard />} />
            <Route path="/quiz" element={<Quiz />} />
            <Route path="/results" element={<Results />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </BrowserRouter>
    </DeckProvider>
  );
}
