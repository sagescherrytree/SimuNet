import { ClassicPreset } from "rete";
import React, { useState, useEffect } from "react";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export class Vec3Control extends ClassicPreset.Control {
  value: Vec3;
  onChange?: (value: Vec3) => void;

  constructor(
    public label: string,
    initial: Vec3,
    onChange?: (value: Vec3) => void
  ) {
    super();
    this.value = initial;
    this.onChange = onChange;
  }

  setValue(value: Vec3) {
    this.value = value;
    this.onChange?.(value);
  }
}

export function Vec3ControlComponent(props: { data: Vec3Control }) {
  const { label, value, setValue } = props.data;
  const [localValue, setLocalValue] = useState<Vec3>(value);

  useEffect(() => setLocalValue(value), [value]);

  const handleChange = (axis: keyof Vec3, newValue: string) => {
    const parsed = newValue === "" ? 0 : parseFloat(newValue);
    const updated = { ...localValue, [axis]: parsed };
    setLocalValue(updated);
    if (!Number.isNaN(parsed)) {
      setValue.call(props.data, updated);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "6px 0",
      }}
    >
      <label
        style={{
          fontSize: "14px",
          color: "#ccc",
          width: "5rem",
          flexShrink: 0,
        }}
      >
        {label}:
      </label>

      <div
        style={{
          display: "flex",
          gap: "8px",
        }}
      >
        {(["x", "y", "z"] as (keyof Vec3)[]).map((axis) => (
          <div
            key={axis}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <label
              style={{
                fontSize: "10px",
                fontWeight: "600",
                color: "#ffffffff",
                textTransform: "uppercase",
                width: "10px",
              }}
            >
              {axis}
            </label>
            <input
              type="number"
              step="0.1"
              value={localValue[axis] ?? 0}
              onChange={(e) => handleChange(axis, e.target.value)}
              style={{
                width: "80px",
                padding: "5px 8px",
                fontSize: "13px",
                border: "1px solid #555",
                borderRadius: "4px",
                backgroundColor: "#333",
                color: "#fff",
                textAlign: "right",
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
