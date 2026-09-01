import type { NoteIcon as NoteIconId } from "@/data/types";
import {
  Bookmark,
  CalendarDays,
  CircleCheck,
  FileText,
  MapPin,
  Sparkles,
  Target,
} from "lucide-react";

const MAP = {
  "pin-place": MapPin,
  "circle-check": CircleCheck,
  sparkle: Sparkles,
  bookmark: Bookmark,
  file: FileText,
  target: Target,
  calendar: CalendarDays,
} as const;

export function NoteIcon({
  id,
  size = 13,
  className,
}: {
  id: NoteIconId;
  size?: number;
  className?: string;
}) {
  const Icon = MAP[id] ?? FileText;
  return <Icon size={size} strokeWidth={1.9} className={className} />;
}
