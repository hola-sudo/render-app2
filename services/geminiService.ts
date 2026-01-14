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
 * CAMBIO LIGERO: Pedir detalles de material (mate/brillante) para ayudar al realismo.
 */
export const detectSceneElements = async (originalImages: File[]): Promise<string> => {
  if (originalImages.length === 0) return 'No images provided.';

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
  const imageParts = await Promise.all(originalImages.map(file => fileToPart(file)));

  const prompt = `
  TASK: Analyze the geometry and materials of this SketchUp scene for a HIGH-END RENDER.
  OUTPUT FORMAT: Technical List.
  
  1. Identify the CAMERA ANGLE (e.g., Wide shot, Eye level).
  2. List the MATERIALS mapped to specific objects.
     - Specify texture qualities if visible (e.g. "Shiny metal", "Rough wood", "Velvet fabric").
     - Example: "Round tables -> White linen tablecloth (matte)."
  3. Identify EMPTY SPACES (e.g., "Right foreground is empty grass").
  
  Note: Be literal. Do not invent objects. Focus on material properties.
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
 * CAMBIO: Inyectar palabras clave de "Ultra-Realismo" y "PBR" sin tocar la geometría.
 */
export const refinePromptForGeneration = async (
  sceneElementsDescription: string,
  lightingType: LightingType,
  advancedLightingInstructions: string,
  // Corrected types to match LightingConfig interface from types.ts
  colorTemperature: 'warm' | 'neutral' | 'cool' | 'golden',
  exposureCompensation: 'standard' | 'brighter' | 'darker' | 'very_bright' | 'very_dark',
  contrastEnhancement: 'natural' | 'enhanced' | 'soft' | 'high_contrast' | 'low_contrast',
  hasReferenceImages: boolean = false
): Promise<string> => {
  
  let lightingDetails = '';
  switch (lightingType) {
    case LightingType.Day: lightingDetails = "Lighting: Natural daylight. Brightness: Normal. Shadows: Soft and realistic."; break;
    case LightingType.Sunset: lightingDetails = "Lighting: Golden hour. Warm tones. Long shadows."; break;
    case LightingType.Night: lightingDetails = "Lighting: NIGHT MODE. Deep blue sky, dark environment. Light only from candles/lamps. Cinematic contrast."; break;
  }

  const referenceInstruction = hasReferenceImages
    ? `REFERENCES: Use attached images for TEXTURE and MATERIAL definitions (e.g. fabric weave, flower petals). Do NOT copy the object shapes.`
    : '';

  // PROMPT OPTIMIZADO PARA REALISMO DE TEXTURAS
  const refinementPrompt = `
  ### SYSTEM INSTRUCTION: HIGH-FIDELITY TEXTURE ENGINE ###
  
  You are a Technical Rendering Engine. Your goal is to apply **Ultra-Photorealistic 8K Textures** to a strict geometry wireframe.

  ### CRITICAL OUTPUT PARAMETERS ###
  1. **ASPECT RATIO:** 16:9 (Landscape).
  2. **GEOMETRY:** LOCKED. Match input exactly. No new objects.
  3. **TEXTURE QUALITY (PRIORITY):** Apply PBR (Physically Based Rendering) materials.
     - **Fabrics:** Show micro-details (weave, seams, natural folds).
     - **Metals:** Realistic reflection, anisotropy, and gloss.
     - **Glass:** Physically accurate refraction and caustics.
     - **Vegetation:** Subsurface scattering on leaves/petals.
     - **Overall:** Eliminate "cartoonish" or "plastic" looks. Look like a high-end architectural photograph.

  ### SCENE DATA ###
  **Lighting:** ${lightingDetails} ${advancedLightingInstructions}
  **Atmosphere:** Color Temp: ${colorTemperature}, Contrast: ${contrastEnhancement}. Style: Award-Winning Event Photography.
  **Materials to Render:**
  ${sceneElementsDescription}

  ${referenceInstruction}

  Generate a precise image generation prompt that enforces a 16:9 aspect ratio, strict geometry, AND maximizes texture realism (8k, PBR).
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
 * Mantiene la configuración 16:9 intacta.
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
      model: 'gemini-3-pro-image-preview',
      contents: { parts },
      config: { 
        responseModalities: [Modality.IMAGE], 
        safetySettings,
        generationConfig: {
            aspectRatio: "16:9",
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
 * CAMBIO: "Strict Lock" ahora incluye instrucciones de calidad 8K.
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
  
  onProgress(`Configurando texturas PBR y geometría...`);

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

    // Prompt final reforzado con calidad 8K y realismo
    const strictLock = " --aspect-ratio 16:9 [IMPORTANT: OUTPUT MUST BE 16:9 LANDSCAPE. NO SQUARE. NO CROPPING. KEEP EMPTY AREAS EMPTY. RENDER WITH 8K PHOTOREALISTIC TEXTURES AND PBR MATERIALS.]";
    const combinedPrompt = finalPrompt + strictLock;

    console.log("Prompt enviado:", combinedPrompt);
    onProgress(`Renderizando escena en 16:9 con alta fidelidad...`);
    
    const imageUrl = await generateEventRender(sketchupImage, combinedPrompt, referenceImages);
    return { url: imageUrl, error: null };
  } catch (error: any) {
    console.error(error);
    return { url: null, error: error.message || 'Error desconocido' };
  }
};