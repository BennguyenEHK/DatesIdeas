"use client";

import { useParams } from "next/navigation";
import { RecordingsGallery } from "@/components/RecordingsGallery";

export default function RecordingsPage() {
  const params = useParams<{ room: string }>();
  return (
    <main className="min-h-screen bg-[var(--night)]">
      <RecordingsGallery room={params.room} />
    </main>
  );
}
