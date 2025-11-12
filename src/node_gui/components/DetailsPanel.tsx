import React, { useState, useEffect } from "react";
import { Node } from "../types";
import {
  NumberControl,
  NumberControlComponent,
} from "../controls/NumberControl";
import { Vec3Control, Vec3ControlComponent } from "../controls/Vec3Control";
import { ClassicPreset } from "rete";

const panelStyle: React.CSSProperties = {
  width: "90%",
  padding: "10px",
  margin: "2rem",
  backgroundColor: "#2d2d2d",
  color: "white",
  height: "40vh",
  boxSizing: "border-box",
  overflowY: "auto",
};

const headingStyle: React.CSSProperties = {
  fontSize: "1.2em",
  borderBottom: "1px solid #555",
  paddingBottom: "8px",
  marginBottom: "16px",
};

const controlContainerStyle: React.CSSProperties = {
  marginBottom: "12px",
};

type DetailsPanelProps = {
  node: Node | null;
};

export function DetailsPanel({ node }: DetailsPanelProps) {
  const [, forceUpdate] = useState({});

  useEffect(() => {
    const interval = setInterval(() => forceUpdate({}), 100);
    return () => clearInterval(interval);
  }, [node]);

  if (!node) {
    return (
      <div style={panelStyle}>
        <div style={headingStyle}>Details</div>
        <p style={{ color: "#ffffffff" }}>No node selected.</p>
      </div>
    );
  }

  const renderControl = (key: string, control: ClassicPreset.Control) => {
    if (control instanceof NumberControl) {
      return (
        <div key={key} style={controlContainerStyle}>
          <NumberControlComponent data={control} />
        </div>
      );
    }

    if (control instanceof Vec3Control) {
      return (
        <div key={key} style={controlContainerStyle}>
          <Vec3ControlComponent data={control} />
        </div>
      );
    }

    if (control instanceof ClassicPreset.InputControl) {
      const inputControl = control as ClassicPreset.InputControl<any, any>;
      return (
        <div key={key} style={controlContainerStyle}>
          <label
            style={{
              fontSize: "12px",
              color: "#999",
              display: "block",
              marginBottom: "4px",
            }}
          >
            {key}:
          </label>
          <input
            type={inputControl.type}
            value={inputControl.value ?? ""}
            onChange={(e) => {
              const newValue =
                inputControl.type === "number"
                  ? parseFloat(e.target.value) || 0
                  : e.target.value;
              inputControl.setValue(newValue);
            }}
            style={{
              width: "100%",
              padding: "4px 8px",
              fontSize: "12px",
              border: "1px solid #555",
              borderRadius: "4px",
              backgroundColor: "#2a2a2a",
              color: "#fff",
            }}
          />
        </div>
      );
    }

    return (
      <div key={key} style={controlContainerStyle}>
        <div style={{ fontSize: "12px", color: "#ffffffff" }}>
          {key}: (unsupported control type)
        </div>
      </div>
    );
  };

  const renderControls = () => {
    // This is all editable node controls
    const editableControls = (node as any).getEditableControls?.();

    if (editableControls) {
      const controlEntries = Object.entries(editableControls);
      return (
        <div>
          {controlEntries.map(([key, control]) =>
            renderControl(key, control as ClassicPreset.Control)
          )}
        </div>
      );
    }

    const controls = node.controls;
    const controlEntries = Object.entries(controls);

    // If no controls are set
    if (controlEntries.length === 0) {
      return (
        <p style={{ color: "#888" }}>This node has no editable properties.</p>
      );
    }

    // This is all controls that are defined in the node
    return (
      <div>
        {controlEntries.map(([key, control]) =>
          renderControl(key, control as ClassicPreset.Control)
        )}
      </div>
    );
  };

  return (
    <div style={panelStyle}>
      <div style={headingStyle}>
        {node.label}
        <div style={{ fontSize: "0.7em", color: "#666", marginTop: "4px" }}>
          ID: {node.id}
        </div>
      </div>
      {renderControls()}
    </div>
  );
}
