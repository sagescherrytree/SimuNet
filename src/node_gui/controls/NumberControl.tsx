// NumberControl.tsx
import { ClassicPreset } from "rete";
import React, { useState, useEffect } from "react";

export class NumberControl extends ClassicPreset.Control {
  value: number;
  onChange?: (value: number) => void;
  stepSize: number;
  min?: number;
  max?: number;

  constructor(
    public label: string,
    initial: number,
    onChange?: (value: number) => void,
    stepSize?: number,
    min?: number,
    max?: number
  ) {
    super();
    this.value = initial;
    this.onChange = onChange;
    this.stepSize = stepSize ?? 0.1;

    this.min = min ?? null;
    this.max = max ?? null;
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

  const stepSize = props.data.stepSize;
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
        step={stepSize}
        min={props.data.min}
        max={props.data.max}
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
