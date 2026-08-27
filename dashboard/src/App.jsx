import { useEffect, useState } from "react";
import SideNav from "./components/SideNav.jsx";
import TopNav from "./components/TopNav.jsx";
import DashboardScreen from "./screens/DashboardScreen.jsx";
import RingList from "./screens/RingList.jsx";
import RingDetailScreen from "./screens/RingDetailScreen.jsx";
import MetricsScreen from "./screens/MetricsScreen.jsx";
import AuditTrailScreen from "./screens/AuditTrailScreen.jsx";
import IngestionScreen from "./screens/IngestionScreen.jsx";

export default function App() {
  const [route, setRoute] = useState({ name: "dashboard" });

  const navigate = (name, params) => setRoute({ name, ...params });

  const navTo = (key) => {
    if (key === "dashboard") navigate("dashboard");
    else if (key === "rings") navigate("rings");
    else if (key === "metrics") navigate("metrics");
    else if (key === "audit") navigate("audit");
    else if (key === "upload") navigate("upload");
    else if (key === "settings") navigate("dashboard");
  };

  useEffect(() => {
    document.title = "Sentra AI — Fraud Detection";
  }, []);

  let content;
  const activeKey =
    route.name === "dashboard" ? "dashboard"
    : route.name === "metrics" ? "metrics"
    : route.name === "audit" ? "audit"
    : route.name === "upload" ? "upload"
    : route.name === "ring" ? "rings"
    : "rings";

  if (route.name === "dashboard") {
    content = (
      <DashboardScreen
        onGoRings={() => navigate("rings")}
        onGoAudit={() => navigate("audit")}
        onSelectRing={(id) => navigate("ring", { ringId: id })}
      />
    );
  } else if (route.name === "rings") {
    content = (
      <RingList
        onSelectRing={(id) => navigate("ring", { ringId: id })}
        onOpenIngest={() => navigate("upload")}
      />
    );
  } else if (route.name === "ring") {
    content = <RingDetailScreen ringId={route.ringId} onBack={() => navigate("rings")} />;
  } else if (route.name === "metrics") {
    content = <MetricsScreen />;
  } else if (route.name === "audit") {
    content = <AuditTrailScreen onSelectRing={(id) => navigate("ring", { ringId: id })} />;
  } else if (route.name === "upload") {
    content = <IngestionScreen onRunDetection={() => navigate("rings")} />;
  } else {
    content = <RingList onSelectRing={(id) => navigate("ring", { ringId: id })} onOpenIngest={() => navigate("upload")} />;
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-on-surface">
      <SideNav active={activeKey} onSelect={navTo} />
      <div className="relative ml-[260px] flex h-full flex-1 flex-col">
        <TopNav systemOk />
        <main className="w-full flex-1 overflow-y-auto pt-16">
          <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 p-container-padding pb-12">
            {content}
          </div>
        </main>
      </div>
    </div>
  );
}
