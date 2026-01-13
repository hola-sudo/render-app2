import { GoogleGenAI, GenerateContentResponse, Part, Modality, SafetySetting, HarmCategory, HarmBlockThreshold, Type } from "@google/genai";
import { LightingType, ImagePart } from '../types';

// Default safety settings (can be customized)
const safetySettings: SafetySetting[] = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
];

/**
 * Converts a File object to a GoogleGenAI Part object suitable for API requests.
 * @param file The File object to convert.
 * @returns A Promise that resolves to a Part object.
 */
const fileToPart = async (file: File): Promise<Part> => {
  const base64EncodedData = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        // Remove the data:image/jpeg;base64, prefix
        resolve(reader.result.split(',')[1]);
      } else {
        reject(new Error("Failed to read file as Data URL"));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  return {
    inlineData: {
      data: base64EncodedData,
      mimeType: file.type,
    },
  };
};

/**
 * Handles the API response, extracting the base64 image data.
 * @param response The GenerateContentResponse object from the Gemini API.
 * @returns A Promise that resolves to a data URL string of the generated image.
 * @throws An error if no image part is found in the response.
 */
const handleApiResponse = (response: GenerateContentResponse, prompt: string): string => {
  const imagePart = response.candidates?.[0]?.content?.parts?.find(
    (part): part is ImagePart => (part as ImagePart).inlineData !== undefined
  );

  if (imagePart && imagePart.inlineData) {
    const base64EncodeString: string = imagePart.inlineData.data;
    const imageUrl = `data:${imagePart.inlineData.mimeType};base64,${base64EncodeString}`;
    return imageUrl;
  } else {
    // If no image is found, try to extract any text response to aid debugging.
    const textPart = response.candidates?.[0]?.content?.parts?.find(
      (part) => typeof (part as {text?: string}).text === 'string'
    );
    const textOutput = (textPart as {text?: string})?.text;

    console.error("API Response did not contain an image. Full response:", JSON.stringify(response, null, 2));
    console.error("Prompt used:", prompt);
    throw new Error(`No se encontró imagen en la respuesta de la API. ${textOutput ? `Mensaje del modelo: "${textOutput}"` : ''} Por favor, revisa el prompt y la imagen de entrada.`);
  }
};

/**
 * Detects and describes elements from a single uploaded SketchUp image,
 * providing a detailed but structured description for consistent rendering.
 * This function now explicitly forbids inventing geometry and requests a structured output.
 * @param originalImages An array containing a single screenshot file from SketchUp.
 * @returns A Promise that resolves to a string describing the elements of the detected scene in a structured format.
 */
export const detectSceneElements = async (originalImages: File[]): Promise<string> => {
  if (originalImages.length === 0) {
    return 'No images provided for scene detection.';
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
  const imageParts = await Promise.all(originalImages.map(file => fileToPart(file)));

  const prompt = `Eres un Analista de Geometría 3D. Tu tarea es describir la imagen de SketchUp para un motor de renderizado.
  
  Analiza la imagen y genera una lista estricta de asignación de materiales. NO describas la "atmósfera", describe la GEOMETRÍA y qué material debe aplicarse a ella.
  
  Usa este formato estricto:
  * [Objeto/Geometría detectada] -> [Material Fotorrealista a aplicar]
  
  Ejemplo:
  * Plano horizontal inferior -> Suelo de mármol blanco con veteado gris.
  * Prismas rectangulares verticales (fondo) -> Paneles de madera de roble claro.
  * Cilindros sobre las mesas -> Velas de cera blanca.
  * Superficies planas de las mesas -> Mantel de lino marfil con textura visible.
  
  Describe:
  1. La Cámara (perspectiva exacta).
  2. Materiales para Arquitectura (Suelo, Paredes, Ventanas).
  3. Materiales para Mobiliario (Sillas, Mesas).
  4. Materiales para Decoración (Flores, Vajilla, Velas).
  
  Sé extremadamente literal. Si una zona está vacía, di "Zona vacía: mantener como espacio negativo/aire".
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview', // Use image model to analyze images
      contents: [...imageParts, { text: prompt }], // All images and the prompt
      config: {
        safetySettings,
      },
    });

    const detectedText = response.text?.trim();
    if (detectedText) {
      return detectedText;
    }
    return 'No se pudieron detectar elementos comunes de las escenas. Por favor, revisa las imágenes.';
  } catch (error: any) {
    if (error.message && error.message.includes("Requested entity was not found.")) {
      throw new Error("Invalid API Key. Please select a valid API key from a paid GCP project.");
    }
    throw new Error(`Error al detectar elementos de la escena: ${error.message || 'Error desconocido'}`);
  }
};


/**
 * Refines all user descriptions into a single, highly detailed prompt for image generation.
 * This function now includes ULTRA-CRITICAL directives for geometry, PBR materials, and camera perspective.
 * @param sceneElementsDescription The user-edited description of a specific scene's elements.
 * @param lightingType The chosen general lighting type.
 * @param advancedLightingInstructions Optional: specific instructions for lighting placement.
 * @param colorTemperature Chosen color temperature ('warm', 'neutral', 'cool', 'golden').
 * @param exposureCompensation Chosen exposure compensation ('standard', 'brighter' , 'darker', 'very_bright', 'very_dark').
 * @param contrastEnhancement Chosen contrast enhancement ('natural', 'enhanced', 'soft', 'high_contrast', 'low_contrast').
 * @param hasReferenceImages Boolean indicating if GLOBAL reference images are provided.
 * @returns A Promise that resolves to the final refined prompt string.
 */
export const refinePromptForGeneration = async (
  sceneElementsDescription: string,
  lightingType: LightingType,
  advancedLightingInstructions: string,
  colorTemperature: 'warm' | 'neutral' | 'cool' | 'golden',
  exposureCompensation: 'standard' | 'brighter' | 'darker' | 'very_bright' | 'very_dark',
  contrastEnhancement: 'natural' | 'enhanced' | 'soft' | 'high_contrast' | 'low_contrast',
  hasReferenceImages: boolean = false
): Promise<string> => {
  // Lighting configuration based on selection
  let lightingDetails = '';
  switch (lightingType) {
    case LightingType.Day:
      lightingDetails = "Iluminación: Luz diurna brillante y suave, natural. Atmósfera aireada con exposición uniforme, sombras naturales realistas y sutiles. Sin focos duros ni efectos de lente fotográficos artificiales (por ejemplo, destellos, brillos o halos exagerados).";
      break;
    case LightingType.Sunset:
      lightingDetails = "Iluminación: Luz cálida y dorada de atardecer. Ambiente mágico y etéreo con sombras alargadas y colores ricos. La luz debe ser suave y direccional, sin destellos o halos artificiales que no sean físicamente realistas de la hora dorada.";
      break;
    case LightingType.Night:
      lightingDetails = "Iluminación: Ambiente nocturno íntimo. Fuentes de luz primaria como velas o luces de cadena con un brillo cálido, suave y difuso, realistas. La luz ambiental debe ser dorada o tenue, sin efectos de lente fotográficos exagerados (por ejemplo, destellos, brillos o halos artificiales). Las llamas de las velas deben emitir un brillo suave y realista sin destellos de lente exagerados. El fondo debe estar sutilmente atenuado para enfatizar las mesas y el primer plano.";
      break;
  }

  // Add advanced lighting instructions based on new parameters
  let advancedLightingCommand = '';
  switch (colorTemperature) {
    case 'warm': advancedLightingCommand += "La temperatura de color general es cálida, con tonos dorados y ámbar dominantes, evocando confort. "; break;
    case 'neutral': advancedLightingCommand += "La temperatura de color es neutra y equilibrada, sin dominancia de tonos cálidos o fríos. "; break;
    case 'cool': advancedLightingCommand += "La temperatura de color general es fría, con tonos azules y cian dominantes, evocando una sensación de frescura. "; break;
    case 'golden': advancedLightingCommand += "La temperatura de color general es dorada y muy cálida, como la luz del sol al atardecer, creando un brillo etéreo. "; break;
  }
  switch (exposureCompensation) {
    case 'standard': advancedLightingCommand += "La exposición es estándar y bien equilibrada. "; break;
    case 'brighter': advancedLightingCommand += "La imagen tiene una exposición ligeramente más brillante, con un ambiente más luminoso. "; break;
    case 'darker': advancedLightingCommand += "La imagen tiene una exposición ligeramente más oscura, con un un ambiente más dramático o íntimo. "; break;
    case 'very_bright': advancedLightingCommand += "La imagen tiene una exposición muy brillante, con zonas luminosas que pueden tener un ligero bloom. "; break;
    case 'very_dark': advancedLightingCommand += "La imagen tiene una exposición muy oscura, con sombras profundas y un ambiente misterioso. "; break;
  }
  switch (contrastEnhancement) {
    case 'natural': advancedLightingCommand += "El contraste es natural y realista. "; break;
    case 'enhanced': advancedLightingCommand += "El contraste está ligeramente mejorado para mayor viveza y separación tonal. "; break;
    case 'soft': advancedLightingCommand += "El contraste es suave y delicado, para una atmósfera etérea. "; break;
    case 'high_contrast': advancedLightingCommand += "El contraste es alto y dramático, con negros profundos y blancos brillantes. "; break;
    case 'low_contrast': advancedLightingCommand += "El contraste es bajo, con una apariencia más plana y desaturada, pero elegante. "; break;
  }

  // Combine with user's specific advanced lighting instructions
  if (advancedLightingInstructions) {
    advancedLightingCommand += `Instrucciones de iluminación muy específicas: ${advancedLightingInstructions}`;
  }


  const referenceImageInstruction = hasReferenceImages
    ? `NOTA SOBRE REFERENCIAS: Usa las imágenes de referencia SOLAMENTE para copiar el 'Color', 'Textura' y 'Material'. IGNORA COMPLETAMENTE la forma, geometría o perspectiva de las imágenes de referencia. La forma la dicta ÚNICAMENTE la imagen de SketchUp.`
    : '';

  // Combine all inputs into a comprehensive prompt for the prompt refinement model
  const refinementPrompt = `
  ACTÚA COMO: Un Motor de Renderizado PBR (Physically Based Rendering) Técnico y Estricto, NO como un diseñador creativo.
  
  TAREA: Tu ÚNICA función es realizar un "Texture Mapping" (Mapeado de Texturas) y "Lighting Pass" (Pase de Iluminación) sobre la geometría EXACTA de la imagen de entrada (SketchUp).

  INPUT:
  1. Una imagen de SketchUp (que actúa como "Geometry Pass" o "Depth Map" inmutable).
  2. Instrucciones de materiales (descripción).
  3. Imágenes de referencia (SOLO para extraer texturas/materiales, IGNORAR su geometría).

  REGLAS DE ORO (VIOLARLAS CAUSA FALLO DEL SISTEMA):
  1. **CONGELAMIENTO DE CÁMARA:** La imagen de salida debe superponerse perfectamente píxel a píxel con la entrada. NO muevas la cámara, NO cambies el FOV, NO cambies el encuadre. La perspectiva es SAGRADA.
  2. **CONGELAMIENTO DE GEOMETRÍA:** NO añadas objetos. NO quites objetos. NO arregles modelados "feos". Si el modelo de SketchUp es un cubo simple, renderiza un cubo fotorrealista, no lo transformes en una mesa compleja. Respeta las líneas rectas y la perspectiva cónica del dibujo original.
  3. **INFERENCIA DE TEXTURAS:** Aplica materiales fotorrealistas sobre las superficies definidas por las líneas del dibujo.
     - Si ves líneas de un piso -> Aplica textura de mármol/madera respetando la perspectiva.
     - Si ves un cilindro -> Aplica textura de vidrio/metal/cera.
  4. **PROHIBIDO ALUCINAR:** No inventes ventanas, puertas, o muebles que no estén dibujados explícitamente en el SketchUp.

  ESTILO VISUAL: Fotografía de evento de alta gama, Award-Winning Photography, 8K resolution, Unreal Engine 5 render style.

  INSTRUCCIONES DE ILUMINACIÓN:
  ${lightingDetails} ${advancedLightingCommand}

  DESCRIPCIÓN DE MATERIALES A APLICAR (Aplica esto a la geometría existente):
  ${sceneElementsDescription}

  ${referenceImageInstruction}

  Genera el prompt final optimizado para que el modelo de imagen ejecute este renderizado técnico sin desviarse un solo píxel de la estructura original.
  `;

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", // Using a text model for prompt refinement
      contents: refinementPrompt,
    });
    return response.text?.trim() || "No se pudo refinar el prompt.";
  } catch (error: any) {
    if (error.message && error.message.includes("Requested entity was not found.")) {
      throw new Error("Invalid API Key. Please select a valid API key from a paid GCP project.");
    }
    throw new Error(`Error al refinar el prompt: ${error.message || 'Error desconocido'}`);
  }
};


/**
 * Generates a photorealistic render for a single SketchUp image.
 * This is now a private helper function used by `generateSingleRender`.
 * @param originalImage The screenshot of SketchUp.
 * @param finalPrompt The highly detailed and refined prompt for image generation.
 * @param referenceImages An array of File objects for specific visual references.
 * @returns A Promise that resolves to a data URL string of the generated image.
 */
const generateEventRender = async (
  originalImage: File,
  finalPrompt: string,
  referenceImages: File[]
): Promise<string> => {
  // Create a new GoogleGenAI instance right before making an API call
  // to ensure it always uses the most up-to-date API key from the dialog.
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
  const originalImagePart = await fileToPart(originalImage);
  const textPart = { text: finalPrompt };

  // Convert all reference images to Part objects
  const referenceImageParts = await Promise.all(
    referenceImages.map(file => fileToPart(file))
  );

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview', // Pro image model for high-quality final render
      contents: { parts: [originalImagePart, ...referenceImageParts, textPart] }, // Include all parts
      config: {
        responseModalities: [Modality.IMAGE, Modality.TEXT],
        safetySettings,
      },
    });
    return handleApiResponse(response, finalPrompt); // Pass the prompt for better error logging
  } catch (error: any) {
    if (error.message && error.message.includes("Requested entity was not found.")) {
      throw new Error("Invalid API Key. Please select a valid API key from a paid GCP project.");
    }
    throw error;
  }
};

/**
 * Generates a photorealistic render for a single SketchUp image.
 * @param sketchupImage The File object for the SketchUp scene.
 * @param sceneDescription The single string description for the scene, refined by the user.
 * @param referenceImages An array of File objects for specific visual references.
 * @param lightingType The chosen general lighting type.
 * @param advancedLightingInstructions Optional: specific instructions for lighting placement.
 * @param colorTemperature Chosen color temperature ('warm', 'neutral', 'cool', 'golden').
 * @param exposureCompensation Chosen exposure compensation ('standard', 'brighter' , 'darker', 'very_bright', 'very_dark').
 * @param contrastEnhancement Chosen contrast enhancement ('natural', 'enhanced', 'soft', 'high_contrast', 'low_contrast').
 * @param onProgress Callback function to report progress message.
 * @returns A Promise that resolves to an object containing the data URL string or an error message.
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
  onProgress: (message: string) => void // Simplified progress callback
): Promise<{ url: string | null; error: string | null }> => {
  onProgress(`Refinando prompt para la escena...`);

  if (!sceneDescription.trim()) {
    const errorMessage = 'Error: Descripción de la escena faltante.';
    onProgress(errorMessage);
    return { url: null, error: errorMessage };
  }

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
    console.log(`Final Prompt for the Scene:`, finalPrompt); // Log the final prompt for debugging

    // Add technical prefix before sending to image generation
    const technicalPrefix = "High fidelity image-to-image transformation. Keep input strict geometry. ";
    const combinedPrompt = technicalPrefix + finalPrompt;

    onProgress(`Generando render para la escena...`);
    const imageUrl = await generateEventRender(
      sketchupImage,
      combinedPrompt, // Usar el prompt combinado
      referenceImages
    );
    return { url: imageUrl, error: null };
  } catch (error: any) {
    let errorMessage = 'Error desconocido al generar la escena.';

    if (error.message && error.message.includes("Requested entity was not found.")) {
      errorMessage = `${error.message} Un enlace a la documentación de facturación se puede encontrar en ai.google.dev/gemini-api/docs/billing.`;
    } else if (error.error && error.error.code === 500 && error.error.message === "Internal error encountered.") {
      errorMessage = `Error interno del servidor (500) al generar la imagen. Esto puede ser un problema temporal del servicio o que la combinación de entradas (imágenes y prompt) sea demasiado compleja para el modelo. Por favor, intenta:
      1. Reducir la complejidad de la descripción de la escena.
      2. Usar menos imágenes de referencia o de menor resolución.
      3. Reintentar la generación en unos minutos.`;
    } else {
      errorMessage = `Error al generar la escena: ${error.message || 'Error desconocido'}.`;
    }

    onProgress(`Error al generar la escena: ${errorMessage}`);
    console.error(`Error generating render:`, error);
    return { url: null, error: errorMessage };
  }
};