"use client";

import type { CanvasOp, Scene } from "@/lib/createspace/ops";
import type { CreateSession } from "@/lib/createspace/session";
import type { CustomLook } from "@/lib/looks/types";
import { DoodleWorkshop } from "./createspace/DoodleWorkshop";
import { StripDesigner } from "./createspace/StripDesigner";
import { WorkshopMenu } from "./createspace/WorkshopMenu";

export type CreateSpaceProps = {
  identity: string;
  room: string;
  sharedNow: () => number;
  scene: Scene;
  baseItemId: string | null;
  session: CreateSession;
  onOp: (op: CanvasOp) => void;
  onBase: (itemId: string | null) => void;
  onSession: (patch: Partial<Omit<CreateSession, "at" | "by">>) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  editStripUrl: string | null;
  onFinishEdit: () => void;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  paired: boolean;
  onLookSaved?: (look: CustomLook) => void;
};

export function CreateSpace(props: CreateSpaceProps) {
  if (props.session.workshop === "menu") {
    return <WorkshopMenu onSession={props.onSession} onOp={props.onOp} />;
  }

  if (props.session.workshop === "doodle") {
    return <DoodleWorkshop {...props} />;
  }

  return <StripDesigner {...props} />;
}
