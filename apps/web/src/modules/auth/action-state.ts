export type ActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

export const initialActionState: ActionState = { status: "idle" };
