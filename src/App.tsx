import { useEffect } from "react";
import { Palette } from "./components/Palette";
import { Toolbar } from "./components/Toolbar";
import { CanvasStage } from "./components/CanvasStage";
import { useStore } from "./state/store";
import "./App.css";

export default function App() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const s = useStore.getState();
      if (e.key === "r") s.rotateSelected(45);
      else if (e.key === "R") s.rotateSelected(-45);
      else if (e.key === "f") s.flipSelected();
      else if (e.key === "Delete" || e.key === "Backspace") s.deleteSelected();
      else if (e.key === " ") {
        e.preventDefault();
        s.setRunning(!s.running);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <div className="body">
        <Palette />
        <CanvasStage />
      </div>
    </div>
  );
}
