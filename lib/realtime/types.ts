export type AirMouseEvent =
  | {
      type: "move";
      dx: number;
      dy: number;
    }
  | {
      type: "left-click";
    }
  | {
      type: "right-click";
    }
  | {
      type: "controller-connected";
    }
  | {
      type: "controller-disconnected";
    };
