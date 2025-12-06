import { ClassicPreset } from "rete";
import React, { useState, useEffect } from "react";

export interface DropdownOption {
  value: number | string;
  label: string;
}

export class DropdownControl extends ClassicPreset.Control {
  value: number;
  options: DropdownOption[];
  onChange?: (value: number) => void;

  constructor(
    public label: string,
    initialValue: number,
    onChange?: (value: number) => void,
    options?: DropdownOption[]
  ) {
    super();
    this.value = initialValue;
    this.onChange = onChange;
    this.options = options ?? [];
  }

  setValue(value: number) {
    this.value = value;
    this.onChange?.(value);
  }
}

export function DropdownControlComponent({ data }: { data: DropdownControl }) {
  const { label, value, options, setValue } = data;
  const [localValue, setLocalValue] = useState<number>(value);

  useEffect(() => setLocalValue(value), [value]);

  const handleChange = (newValue: string) => {
    const parsed = Number(newValue);
    setLocalValue(parsed);
    setValue.call(data, parsed);
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
          width: "8rem",
          flexShrink: 0,
        }}
      >
        {label}:
      </label>

      <select
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        style={{
          padding: "5px 8px",
          fontSize: "13px",
          border: "1px solid #555",
          borderRadius: "4px",
          backgroundColor: "#333",
          color: "#fff",
          cursor: "pointer",
          width: "20rem",
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
