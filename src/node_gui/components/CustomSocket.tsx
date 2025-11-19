import * as React from "react";
import { ClassicPreset } from "rete";
import styled from "styled-components";

const socketColors = {
  default: {
    bg: "#66BB6A",
    border: "#c0c0c0ff",
    hover: "#569c5aff",
  },
};

const Styles = styled.div`
  display: inline-block;
  cursor: pointer;

  border-radius: 50%;

  width: 25px;
  height: 25px;

  border: 2px solid ${socketColors.default.border};
  background: ${socketColors.default.bg};

  vertical-align: middle;
  z-index: 2;
  box-sizing: border-box;

  &:hover {
    background: ${socketColors.default.hover};
    border-color: ${socketColors.default.border};
  }
`;

export function CustomSocket<T extends ClassicPreset.Socket>(props: {
  data: T;
}) {
  return <Styles title={props.data.name} />;
}
