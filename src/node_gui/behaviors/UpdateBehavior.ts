import { IUpdatable } from "../interfaces/NodeCapabilities";

/**
 * Composable behavior for handling updates
 */
export class UpdateBehavior implements IUpdatable {
  public onUpdate?: () => void;

  setUpdateCallback(callback: () => void) {
    this.onUpdate = callback;
  }

  triggerUpdate() {
    if (this.onUpdate) {
      this.onUpdate();
    }
  }
}
