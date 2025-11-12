// NumberControl.tsx
import { ClassicPreset } from "rete";
import React, { useState, useEffect } from "react";

export class NumberControl extends ClassicPreset.Control {
  value: number;
  onChange?: (value: number) => void;

  constructor(
    public label: string,
    initial: number,
    onChange?: (value: number) => void
  ) {
    super();
    this.value = initial;
    this.onChange = onChange;
  }

  setValue(value: number) {
    this.value = value;
    this.onChange?.(value);
  }
}

export function NumberControlComponent(props: { data: NumberControl }) {
  const { label, value, setValue } = props.data;
  const [localValue, setLocalValue] = useState(value ?? 0);

  useEffect(() => {
    setLocalValue(value ?? 0);
  }, [value]);

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
      <input
        type="number"
        value={localValue}
        step="0.1"
        onChange={(e) => {
          const newValue =
            e.target.value === "" ? 0 : parseFloat(e.target.value);
          setLocalValue(newValue);
          if (!Number.isNaN(newValue)) {
            setValue.call(props.data, newValue);
          }
        }}
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
  );
}
