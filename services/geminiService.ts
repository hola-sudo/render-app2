import { GoogleGenAI, GenerateContentResponse, Part, Modality, SafetySetting, HarmCategory, HarmBlockThreshold, Type } from "@google/genai";
import { LightingType, ImagePart } from '../types';

// Default safety settings
const safetySettings: SafetySetting[] = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

const fileToPart = async (file: File): Promise<Part> => {
  const base64EncodedData = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') resolve(reader.result.split(',')[1]);
      else reject(new Error("Failed to read file as Data URL"));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  return { inlineData: { data: base64EncodedData, mimeType: file.type } };
};

const handleApiResponse = (response: GenerateContentResponse, prompt: string): string => {
  const imagePart = response.candidates?.[0]?.content?.parts?.find(
    (part): part is ImagePart => (part as ImagePart).inlineData !== undefined
  );

  if (imagePart && imagePart.inlineData) {
    return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
  } else {
    const textPart = response.candidates?.[0]?.content?.parts?.find((part) => typeof (part as {text?: string}).text === 'string');
    const textOutput = (textPart as {text?: string})?.text;
    console.error("API Response error. Full response:", JSON.stringify(response, null, 2));
    throw new Error(`No se encontró imagen. ${textOutput ? `Mensaje del modelo: "${textOutput}"` : ''}`);
  }
};

/**
 * Detects scene elements. 
 */
export const detectSceneElements = async (originalImages: File[]): Promise<string> => {
  if (originalImages.length === 0) return 'No images provided.';

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
  const imageParts = await Promise.all(originalImages.map(file => fileToPart(file)));

  const prompt = `
  TASK: Analyze the geometry and materials of this SketchUp scene.
  OUTPUT FORMAT: Technical List.
  
  1. Identify the CAMERA ANGLE (e.g., Wide shot, Eye level).
  2. List the MATERIALS mapped to specific objects.
     - Example: "Round tables -> White tablecloth."
     - Example: "Backdrop -> Green foliage wall."
  3. Identify EMPTY SPACES (e.g., "Right foreground is empty grass").
  
  Note: Be literal. Do not invent objects.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: [...imageParts, { text: prompt }],
      config: { safetySettings },
    });
    return response.text?.trim() || 'No description available.';
  } catch (error: any) {
    if (error.message?.includes("Requested entity was not found")) {
      throw new Error("Invalid API Key. Please select a valid API key from a paid GCP project.");
    }
    throw new Error(`Error detecting elements: ${error.message}`);
  }
};

/**
 * Refines prompt.
 * CAMBIO CRÍTICO: "Mode: Texture Overlay" para forzar geometría 1:1.
 */
export const refinePromptForGeneration = async (
  sceneElementsDescription: string,
  lightingType: LightingType,
  advancedLightingInstructions: string,
  // Corrected types to match LightingConfig interface
  colorTemperature: 'warm' | 'neutral' | 'cool' | 'golden',
  exposureCompensation: 'standard' | 'brighter' | 'darker' | 'very_bright' | 'very_dark',
  contrastEnhancement: 'natural' | 'enhanced' | 'soft' | 'high_contrast' | 'low_contrast',
  hasReferenceImages: boolean = false
): Promise<string> => {
  
  let lightingDetails = '';
  // Forzamos "Darkness" real en modo noche
  switch (lightingType) {
    case LightingType.Day: lightingDetails = "Lighting: Natural daylight. Brightness: Normal."; break;
    case LightingType.Sunset: lightingDetails = "Lighting: Golden hour. Warm tones."; break;
    case LightingType.Night: lightingDetails = "Lighting: NIGHT MODE. Deep blue sky, dark environment. Light only from candles/lamps."; break;
  }

  const referenceInstruction = hasReferenceImages
    ? `REFERENCES: Use attached images for TEXTURE and MATERIAL definitions only. Do NOT copy the object shapes.`
    : '';

  // PROMPT DE INGENIERÍA INVERSA PARA MANTENER GEOMETRÍA
  const refinementPrompt = `
  ### SYSTEM INSTRUCTION: TEXTURE FILTER MODE ###
  
  You are a Technical Rendering Engine transforming a SketchUp wireframe into a photorealistic image.

  ### CRITICAL OUTPUT PARAMETERS ###
  1. **ASPECT RATIO:** 16:9 (Landscape). DO NOT PRODUCE A SQUARE IMAGE.
  2. **COMPOSITION:** MATCH THE INPUT IMAGE EXACTLY. Do not zoom in. Do not zoom out. Do not crop.
  3. **GEOMETRY:** Keep the scene layout identical. Do not add furniture to empty grass areas.

  ### SCENE DATA ###
  **Lighting:** ${lightingDetails} ${advancedLightingInstructions}
  **Atmosphere:** Color Temp: ${colorTemperature}, Contrast: ${contrastEnhancement}.
  **Materials to Render:**
  ${sceneElementsDescription}

  ${referenceInstruction}

  Generate a precise image generation prompt that enforces a 16:9 aspect ratio and strict adherence to the input geometry.
  `;

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: refinementPrompt,
    });
    return response.text?.trim() || "Prompt error.";
  } catch (error: any) {
    throw new Error(`Error refining prompt: ${error.message}`);
  }
};

/**
 * Generate Event Render
 * CAMBIO CRÍTICO: Configuración de 'aspectRatio' añadida al objeto de configuración.
 */
const generateEventRender = async (originalImage: File, finalPrompt: string, referenceImages: File[]): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
  const parts = [
    await fileToPart(originalImage),
    ...await Promise.all(referenceImages.map(f => fileToPart(f))),
    { text: finalPrompt }
  ];

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview', // Asegúrate que tu clave tenga acceso a este modelo o usa 'gemini-pro-vision' / 'imagen-3' según disponibilidad
      contents: { parts },
      config: { 
        responseModalities: [Modality.IMAGE], 
        safetySettings,
        // AQUÍ ESTÁ LA SOLUCIÓN TÉCNICA:
        // Use generationConfig as per @google/genai guidelines
        generationConfig: {
            aspectRatio: "16:9", // Forzar formato panorámico
            responseMimeType: "image/jpeg"
        }
      },
    });
    return handleApiResponse(response, finalPrompt);
  } catch (error: any) {
    if (error.message?.includes("Requested entity was not found")) throw new Error("Invalid API Key.");
    throw error;
  }
};

/**
 * Main generation function.
 * CAMBIO: Prefijo técnico reforzado para evitar movimiento de cámara.
 */
export const generateSingleRender = async (
  sketchupImage: File,
  sceneDescription: string,
  referenceImages: File[],
  lightingType: LightingType,
  advancedLightingInstructions: string,
  colorTemperature: 'warm' | 'neutral' | 'cool' | 'golden',
  exposureCompensation: 'standard' | 'brighter' | 'darker' | 'very_bright' | 'very_dark',
  contrastEnhancement: 'natural' | 'enhanced' | 'soft' | 'high_contrast' | 'low_contrast',
  onProgress: (message: string) => void
): Promise<{ url: string | null; error: string | null }> => {
  
  onProgress(`Configurando formato 16:9 y geometría...`);

  if (!sceneDescription.trim()) return { url: null, error: 'Falta descripción.' };

  try {
    const finalPrompt = await refinePromptForGeneration(
      sceneDescription,
      lightingType,
      advancedLightingInstructions,
      colorTemperature,
      exposureCompensation,
      contrastEnhancement,
      referenceImages.length > 0
    );

    // Prompt final reforzado
    const strictLock = " --aspect-ratio 16:9 [IMPORTANT: OUTPUT MUST BE 16:9 LANDSCAPE. NO SQUARE. NO CROPPING. KEEP EMPTY AREAS EMPTY.]";
    const combinedPrompt = finalPrompt + strictLock;

    console.log("Prompt enviado:", combinedPrompt);
    onProgress(`Renderizando escena en 16:9...`);
    
    const imageUrl = await generateEventRender(sketchupImage, combinedPrompt, referenceImages);
    return { url: imageUrl, error: null };
  } catch (error: any) {
    console.error(error);
    return { url: null, error: error.message || 'Error desconocido' };
  }
};