import { useStore } from "../state/store";

export function Toolbar() {
  const running = useStore((s) => s.running);
  const setRunning = useStore((s) => s.setRunning);
  const speed = useStore((s) => s.speed);
  const setSpeed = useStore((s) => s.setSpeed);
  const selectedId = useStore((s) => s.selectedId);
  const rotateSelected = useStore((s) => s.rotateSelected);
  const flipSelected = useStore((s) => s.flipSelected);
  const deleteSelected = useStore((s) => s.deleteSelected);
  const clear = useStore((s) => s.clear);
  const save = useStore((s) => s.save);
  const load = useStore((s) => s.load);
  const exportJSON = useStore((s) => s.exportJSON);
  const importJSON = useStore((s) => s.importJSON);

  const onExport = () => {
    const blob = new Blob([exportJSON()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "traintrack-layout.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      file.text().then(importJSON);
    };
    input.click();
  };

  const hasSel = !!selectedId;

  return (
    <div className="toolbar">
      <span className="brand">🚂 TrainTrack</span>
      <button className={running ? "primary on" : "primary"} onClick={() => setRunning(!running)}>
        {running ? "⏸ Pause" : "▶ Play"}
      </button>
      <label className="speed">
        Speed
        <input type="range" min={20} max={400} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
      </label>

      <span className="divider" />
      <button disabled={!hasSel} onClick={() => rotateSelected(-45)}>⟲ 45°</button>
      <button disabled={!hasSel} onClick={() => rotateSelected(45)}>⟳ 45°</button>
      <button disabled={!hasSel} onClick={flipSelected}>⇅ Flip</button>
      <button disabled={!hasSel} onClick={deleteSelected}>🗑 Delete</button>

      <span className="divider" />
      <button onClick={save}>Save</button>
      <button onClick={load}>Load</button>
      <button onClick={onExport}>Export</button>
      <button onClick={onImport}>Import</button>
      <button onClick={clear}>Clear</button>
    </div>
  );
}
