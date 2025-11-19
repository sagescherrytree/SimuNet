// src/components/nodes/NodeA.ts
import { ClassicPreset } from "rete";
import {
  IExecutable,
  IUpdatable,
  IControllable,
} from "../interfaces/NodeCapabilities";
import { GeometryBehavior } from "../behaviors/GeometryBehavior";
import { UpdateBehavior } from "../behaviors/UpdateBehavior";
import { IOBehavior } from "../behaviors/IOBehavior";
import { GeometryData } from "../geometry/geometry";

export abstract class Node
  extends ClassicPreset.Node
  implements IExecutable, IUpdatable, IControllable
{
  height = 100;
  width = 200;

  protected geometryBehavior: GeometryBehavior;
  protected updateBehavior: UpdateBehavior;
  protected ioBehavior: IOBehavior;

  public geometry?: GeometryData;

  public isRemoved: boolean;

  public onUpdate?: () => void;

  constructor(name: string) {
    super(name);
    this.geometryBehavior = new GeometryBehavior(this.id);
    this.updateBehavior = new UpdateBehavior();
    this.ioBehavior = new IOBehavior(this);
    this.isRemoved = false;
  }

  abstract execute(inputs?: Record<string, any>): Promise<any>;
  abstract getEditableControls(): Record<string, any>;

  setUpdateCallback(callback: () => void) {
    this.updateBehavior.setUpdateCallback(callback);
    this.onUpdate = callback;
  }
}
