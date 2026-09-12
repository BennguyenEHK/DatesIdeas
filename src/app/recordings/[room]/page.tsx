"use client";

import { useParams } from "next/navigation";
import { RecordingsGallery } from "@/components/RecordingsGallery";
import { BackToCall } from "@/components/BackToCall";

export default function RecordingsPage() {
  const params = useParams<{ room: string }>();
  return (
    <main className="min-h-screen bg-[var(--night)]">
      {/* In the letterbox bar, like every other way out in this app, and above
          the gallery so it is there whether or not anything has been recorded. */}
      <div className="bar-top flex items-center bg-[var(--letterbox)] px-5 py-3">
        <BackToCall room={params.room} />
      </div>
      <RecordingsGallery room={params.room} />
    </main>
  );
}
