import { useEffect } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { TopBar } from "./components/TopBar";
import { CardModal } from "./components/CardModal";
import { EventToast } from "./components/EventToast";
import { useClock, useKeys } from "./clock";
import { useGame } from "./store";
import { Bridge } from "./screens/Bridge";
import { Markets } from "./screens/Markets";
import { Book } from "./screens/Book";
import { Academy } from "./screens/Academy";
import { Debrief } from "./screens/Debrief";
import { Intel } from "./screens/Intel";
import { Finance } from "./screens/Finance";
import { Desk } from "./screens/Desk";
import { Map } from "./screens/Map";

function Shell() {
  useClock();
  useKeys();
  const loadProgress = useGame((g) => g.loadProgress);
  useEffect(() => { void loadProgress(); }, [loadProgress]);
  return (
    <div className="app">
      <TopBar />
      <main id="main">
        <Routes>
          <Route path="/" element={<Navigate to="/academy" replace />} />
          <Route path="/bridge" element={<Bridge />} />
          <Route path="/markets" element={<Markets />} />
          <Route path="/desk" element={<Desk />} />
          <Route path="/map" element={<Map />} />
          <Route path="/book" element={<Book />} />
          <Route path="/intel" element={<Intel />} />
          <Route path="/finance" element={<Finance />} />
          <Route path="/academy" element={<Academy />} />
          <Route path="/debrief" element={<Debrief />} />
        </Routes>
      </main>
      <CardModal />
      <EventToast />
    </div>
  );
}

export function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
