import { RenderEmit, Presets } from "rete-react-plugin";
import styled, { css } from "styled-components";
import { isGenerator, isModifier, isCombiner, Schemes } from "../types";
import { Node } from "../nodes/Node";

const { RefSocket, RefControl } = Presets.classic;

type NodeExtraData = { width?: number; height?: number };

const nodeColors = {
  generator: {
    bg: "#FCE4EC",
    border: "#F8BBD0",
    borderHover: "#F06292",
    text: "#880E4F",
    bgGradient: "linear-gradient(to bottom, #FCE4EC, #FFF0F5)",
  },
  modifier: {
    bg: "#E3F2FD",
    border: "#90CAF9",
    borderHover: "#42A5F5",
    text: "#0D47A1",
    bgGradient: "linear-gradient(to bottom, #E3F2FD, #F0F8FF)",
  },
  combiner: {
    bg: "#E8F5E9",
    border: "#A5D6A7",
    borderHover: "#66BB6A",
    text: "#1B5E20",
    bgGradient: "linear-gradient(to bottom, #E8F5E9, #F5FFF6)",
  },
  default: {
    bg: "#FAFAFA",
    border: "#E0E0E0",
    borderHover: "#9E9E9E",
    text: "#424242",
    bgGradient: "linear-gradient(to bottom, #FAFAFA, #F5F5F5)",
  },
};

function getNodeColors(node: Node) {
  if (isGenerator(node)) {
    return nodeColors.generator;
  }
  if (isModifier(node)) {
    return nodeColors.modifier;
  }
  if (isCombiner(node)) {
    return nodeColors.combiner;
  }
  return nodeColors.default;
}

export const NodeStyles = styled.div<
  NodeExtraData & { selected: boolean; $colors: typeof nodeColors.default }
>`
  background: ${(props) => props.$colors.bgGradient};
  border: 2px solid ${(props) => props.$colors.border};
  border-radius: 12px;
  cursor: pointer;
  box-sizing: border-box;
  width: ${(props) =>
    Number.isFinite(props.width) ? `${props.width}px` : "200px"};
  height: ${(props) =>
    Number.isFinite(props.height) ? `${props.height}px` : "100px"};
  min-width: 180px;
  padding: 0;
  position: relative;
  user-select: none;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transition: all 0.2s ease;

  ${(props) =>
    props.selected &&
    css`
      background: ${props.$colors.borderHover};
      filter: brightness(0.9);
      border-color: ${props.$colors.borderHover};
      box-shadow: 0 0 0 3px rgba(74, 144, 226, 0.4);
    `}

  .title {
    color: ${(props) => props.$colors.text};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 16px;
    font-weight: 600;
    padding: 12px 16px;
    text-align: center;
    border-bottom: 2px solid ${(props) => props.$colors.border};
    background: ${(props) => props.$colors.bg};
    border-radius: 10px 10px 0 0;
  }

  ${(props) =>
    props.selected &&
    css`
      .title {
        background: transparent;
        color: ${props.$colors.bg};
      }
    `}

  .input, .output {
    & .socket-component {
      background: ${(props) => props.$colors.border};
      border-color: ${(props) => props.$colors.text};

      &:hover {
        background: ${(props) => props.$colors.borderHover};
      }
    }
  }

  /* Input sockets - positioned on TOP edge */
  .input {
    position: absolute;
    top: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Output sockets - positioned on BOTTOM edge */
  .output {
    position: absolute;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Controls section */
  .controls-section {
    padding: 16px 12px;
    min-height: 60px;
  }

  .control {
    padding: 4px 0;
  }
`;

function sortByIndex<T extends [string, undefined | { index?: number }][]>(
  entries: T
) {
  entries.sort((a, b) => {
    const ai = a[1]?.index || 0;
    const bi = b[1]?.index || 0;
    return ai - bi;
  });
}

type Props = {
  data: Schemes["Node"] & NodeExtraData;
  emit: RenderEmit<Schemes>;
};

export function CustomNode({
  data,
  emit,
  selected: _selected,
  ...rest
}: Props & { colors?: any; selected?: any }) {
  const inputs = Object.entries(data.inputs);
  const outputs = Object.entries(data.outputs);
  const controls = Object.entries(data.controls);
  const selected = data.selected || false;
  const { id, label, width, height } = data;

  const nodeInstance = data as Node;

  console.log(`🔍 CustomNode render - ${label}:`, {
    hasToggleOutput: typeof nodeInstance.toggleOutput === "function",
    hasGeometry: !!nodeInstance.geometry,
    outputEnabled: nodeInstance.outputEnabled,
  });

  sortByIndex(inputs);
  sortByIndex(outputs);
  sortByIndex(controls);

  const colors = getNodeColors(nodeInstance);

  const nodeWidth = Number.isFinite(width) ? width : 200;

  return (
    <NodeStyles
      selected={selected}
      width={width}
      height={height}
      $colors={colors}
      className="rete-node"
      data-node-id={id}
      data-testid="node"
      {...rest}
    >
      {/* Input sockets */}
      {inputs.map(([key, input], index) =>
        input ? (
          <div
            key={`input-${key}`}
            className="input"
            style={{
              left: `${((index + 1) * nodeWidth) / (inputs.length + 1)}px`,
              transform: "translate(-50%, -50%)",
            }}
            data-testid={`input-${key}`}
          >
            <RefSocket
              name="input-socket"
              emit={emit}
              side="input"
              socketKey={key}
              nodeId={id}
              payload={input.socket}
            />
          </div>
        ) : null
      )}

      <div className="title" data-testid="title">
        {label}
      </div>

      {nodeInstance.geometry && (
        <div
          style={{
            position: "absolute",
            top: "12px",
            right: "8px",
            pointerEvents: "auto",
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
        >
          <button
            onPointerDown={(e) => {
              console.log(`👆 Button pointer down for node: ${label}`);
              e.stopPropagation(); // Stop Rete from seeing this
              e.preventDefault();
            }}
            onClick={(e) => {
              console.log(`👆 Button clicked for node: ${label}`);
              e.stopPropagation();
              e.preventDefault();
              nodeInstance.toggleOutput();
            }}
            style={{
              padding: "2px 2px",
              fontSize: "10px",
              background: nodeInstance.outputEnabled ? "#3b3b3bff" : "#999",
              color: "transparent",
              border: "1px solid rgba(255,255,255,0.3)",
              borderRadius: "4px",
              cursor: "pointer",
              pointerEvents: "auto",
              display: "block",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = nodeInstance.outputEnabled
                ? "#222222ff"
                : "#777";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = nodeInstance.outputEnabled
                ? "#3b3b3bff"
                : "#999";
            }}
            title={
              nodeInstance.outputEnabled
                ? "Hide from viewport"
                : "Show in viewport"
            }
          >
            {nodeInstance.outputEnabled ? "🟢" : "⚪"}
          </button>
        </div>
      )}

      {/* Controls */}
      {controls.length > 0 && (
        <div className="controls-section">
          {controls.map(([key, control]) => {
            return control ? (
              <div key={key} className="control">
                <RefControl name="control" emit={emit} payload={control} />
              </div>
            ) : null;
          })}
        </div>
      )}

      {/* Output sockets */}
      {outputs.map(([key, output], index) =>
        output ? (
          <div
            key={`output-${key}`}
            className="output"
            style={{
              left: `${((index + 1) * nodeWidth) / (outputs.length + 1)}px`,
              transform: "translate(-50%, 50%)",
            }}
            data-testid={`output-${key}`}
          >
            <RefSocket
              name="output-socket"
              side="output"
              emit={emit}
              socketKey={key}
              nodeId={id}
              payload={output.socket}
            />
          </div>
        ) : null
      )}
    </NodeStyles>
  );
}
