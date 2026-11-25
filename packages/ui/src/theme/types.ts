export type Variant = 'solid' | 'outline' | 'soft' | 'ghost' | 'quiet';
export type Tone = string;
export type Size = 'sm' | 'md' | 'lg';

export interface ToneColors {
  fill: string;
  on: string;
  text: string;
  soft?: string;
}

export interface TypeStyle {
  font: string;
  weight: number;
}

export interface Theme {
  name: string;
  fontSources: readonly string[];
  arrow?: 'chevron' | 'plain';
  type: { body: TypeStyle; heading: TypeStyle; quiet?: TypeStyle; control: TypeStyle };
  colors: { page: string; surface: string; ink: string; inkSoft: string; line: string };
  tones: Record<string, ToneColors>;
  hover?: ToneColors;
  variants: readonly Variant[];
  sizes: Partial<Record<Size, string>>;
  radiusControl: string;
  radiusField: string;
  controlRing: string;
}
