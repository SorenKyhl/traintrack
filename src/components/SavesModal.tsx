import { useState } from "react";
import { useStore } from "../state/store";
import { listSlots, removeSlot, type SaveSlot } from "../state/saves";

interface Props {
  onClose: () => void;
}

export function SavesModal({ onClose }: Props) {
  const saveAs = useStore((s) => s.saveAs);
  const loadSlot = useStore((s) => s.loadSlot);
  const [name, setName] = useState("");
  const [slots, setSlots] = useState<SaveSlot[]>(() => listSlots());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const refresh = () => setSlots(listSlots());

  const onSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    saveAs(trimmed);
    setName("");
    refresh();
  };

  const onLoad = (id: string) => {
    loadSlot(id);
    onClose();
  };

  const onDelete = (id: string) => {
    if (confirmDelete === id) {
      removeSlot(id);
      setConfirmDelete(null);
      refresh();
    } else {
      setConfirmDelete(id);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="saves-modal" onClick={(e) => e.stopPropagation()}>
        <div className="saves-modal-header">
          <h2>Saved layouts</h2>
          <button className="saves-close" onClick={onClose}>✕</button>
        </div>

        <div className="saves-save-row">
          <input
            className="saves-name-input"
            placeholder="Layout name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onClose(); }}
            autoFocus
          />
          <button className="saves-save-btn" onClick={onSave} disabled={!name.trim()}>
            Save
          </button>
        </div>

        {slots.length === 0 ? (
          <p className="saves-empty">No saved layouts yet.</p>
        ) : (
          <ul className="saves-list">
            {slots.map((slot) => (
              <li key={slot.id} className="saves-item">
                <div className="saves-item-info">
                  <span className="saves-item-name">{slot.name}</span>
                  <span className="saves-item-date">
                    {new Date(slot.savedAt).toLocaleString(undefined, {
                      month: "short", day: "numeric", year: "numeric",
                      hour: "numeric", minute: "2-digit",
                    })}
                  </span>
                </div>
                <div className="saves-item-actions">
                  <button onClick={() => onLoad(slot.id)}>Load</button>
                  <button
                    className={confirmDelete === slot.id ? "danger confirming" : "danger"}
                    onClick={() => onDelete(slot.id)}
                    onBlur={() => setConfirmDelete(null)}
                  >
                    {confirmDelete === slot.id ? "Confirm?" : "Delete"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
