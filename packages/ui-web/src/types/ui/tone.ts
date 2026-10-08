import type { TONES } from "../../constants/tone";

export type Tone = (typeof TONES)[keyof typeof TONES];
