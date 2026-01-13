

// Declare a global interface for window.aistudio
// The 'window.aistudio' object is assumed to be globally provided by the AI Studio environment,
// so a manual declaration here is removed to prevent type conflicts and "identical modifiers" errors.

export enum LightingType {
  Day = 'day',
  Sunset = 'sunset',
  Night = 'night',
}

export interface ImagePart {
  inlineData: {
    data: string;
    mimeType: string;
  };
}

// New interface for saving/loading lighting configurations
export interface LightingConfig {
  lightingType: LightingType;
  advancedLightingInstructions: string;
  colorTemperature: 'warm' | 'neutral' | 'cool' | 'golden';
  exposureCompensation: 'standard' | 'brighter' | 'darker' | 'very_bright' | 'very_dark';
  contrastEnhancement: 'natural' | 'enhanced' | 'soft' | 'high_contrast' | 'low_contrast';
}