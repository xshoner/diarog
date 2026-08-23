// 클라이언트/서버 공용 타입

export interface Moment {
  id: string;
  date: string;
  seq: number;
  title: string | null;
  starts_at: string | null;
  ends_at: string | null;
  place_name: string | null;
  place_category: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  linked_event_id: string | null;
  link_confidence: number | null;
  people: Array<{ name: string; source: "calendar" | "user" }>;
  mood: string | null;
  memo: string | null;
  status: "draft" | "confirmed" | "soft_confirmed";
  weather: { temp: number | null; precip: string | null } | null;
  ai: {
    scene_summary?: string;
    facts?: string[];
    inferences?: Array<{ text: string; confidence?: number }>;
    ocr_texts?: string[];
    title_candidates?: string[];
  } | null;
}

export interface PhotoOut {
  id: string;
  taken_at: string;
  lat: number | null;
  lng: number | null;
  gps_source: "exif" | "interpolated" | "none";
  is_receipt: boolean;
  moment_id: string | null;
  thumbUrl: string | null;
  midUrl: string | null;
}

export interface Question {
  id: string;
  moment_id: string;
  question_text: string;
  options: string[];
  target: string;
}

export interface Evidence {
  id: string;
  moment_id: string;
  type: "photo" | "calendar" | "poi" | "weather" | "receipt" | "user_answer" | "interpolated_gps";
  payload: Record<string, unknown>;
  score: number | null;
}

export interface DiaryEntry {
  date: string;
  body_final: string | null;
  one_line: string | null;
  sentences: Array<{ text: string; evidence_refs: string[]; kind: "fact" | "inference" }>;
  edited: boolean;
}

export interface DayBundle {
  date: string;
  moments: Moment[];
  photos: PhotoOut[];
  diary: DiaryEntry | null;
  questions: Question[];
  evidence: Evidence[];
}

export interface Me {
  userId: string;
  email: string;
  name: string;
  avatar: string | null;
  persona: string;
  ritualTime: string;
  calendarConnected: boolean;
  pushEnabled: boolean;
  onboarded: boolean;
  plan: string;
}
