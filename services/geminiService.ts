import { GoogleGenAI, GenerateContentResponse, Part, Modality, SafetySetting, HarmCategory, HarmBlockThreshold, Type } from "@google/genai";
import { LightingType, ImagePart } from '../types';

// Default safety settings (can be customized)
const safetySettings: SafetySetting[] = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    // Fix: Changed HarmBlockBlockThreshold back to HarmBlockThreshold
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    // Fix: Changed HarmBlockBlockThreshold back to HarmBlockThreshold
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    // Fix: Changed HarmBlockBlockThreshold back to HarmBlockThreshold
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    // Fix: Changed HarmBlockBlockThreshold back to HarmBlockThreshold
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

  const prompt = `Eres una IA de análisis visual técnico. Tu única tarea es generar una descripción **concisa, factual y LITERALMENTE 1:1** de la imagen de SketchUp proporcionada.

  **DIRECTIVAS CLAVE:**
  1.  **CÁMARA INVARIABLE Y VISTA 1:1 (PRIORIDAD MÁXIMA):** Describe la **perspectiva de la cámara, el ángulo de visión, el campo de visión y los límites del encuadre EXACTAMENTE** como se presenta en SketchUp. Este es un dato fijo. El render final DEBE ser la **misma fotografía** en su encuadre, sin la más mínima alteración de la vista.
  2.  **Describe SOLO lo que ves:** Reporta exactamente los elementos visibles y sus atributos.
  3.  **Fidelidad Geométrica 1:1:** Respeta las formas, tamaños, colores, patrones y distribución espacial **EXACTAS** de CADA elemento en SketchUp.
  4.  **No Inventes/No Alteres:** NO añadas, elimines, modifiques o inventes ninguna geometría, objeto o detalle que no esté explícitamente en SketchUp.
  5.  **Espacios Vacíos:** Si un área está vacía o con una textura básica (ej. un plano blanco liso), descríbela **literalmente** como tal ("espacio vacío", "fondo blanco liso", "superficie sin textura").
  6.  **Iluminación Excluida:** NO incluyas detalles de iluminación.

  Genera una **descripción estructurada con viñetas** capturando los atributos físicos exactos. Sé **específico pero conciso** en materiales, patrones, colores (nombrando matices), acabados, tipos de objetos y su disposición. Si un elemento no es visible o no existe, menciónalo explícitamente (ej. "Techo: No visible.", "Mesas adicionales: Ausentes.").

  *   **Cámara y Vista (1:1 SketchUp):** [Describe el punto de vista, ángulo y encuadre exactos. Ej: "Cámara fija, punto de vista bajo y central, encuadre cerrado mostrando la mesa principal y parte del fondo." o "Vista frontal a la altura de los ojos, ligeramente angulada hacia la derecha, con un amplio campo de visión que captura toda la longitud del salón."]
  *   **Estilo General del Evento:** [Descripción concisa, si es inferible del diseño.]
  *   **Elementos Arquitectónicos Visibles:** [Paredes, suelo (describir si es liso/básico), ventanas, techo (indicar si no visible). Describir formas y colores.]
  *   **Mobiliario - Sillas:** [Cantidad si es clara, tipo, material, color, cojines (si presentes).]
  *   **Mobiliario - Mesas:** [Cantidad si es clara, tipo, superficie (describir mármol con veteado si aplica, o color liso), base. Indicar explícitamente si NO hay mesas en primer plano.]
  *   **Vajilla (platos, cubiertos, copas):** [Descripción EXACTA de formas, materiales (ej. porcelana, metal), colores, patrones (ej. borde de cuentas doradas), según la geometría de SketchUp.]
  *   **Servilletas:** [Material, color, FORMA DE DOBLADO EXACTA según SketchUp, accesorios (ej. anillo dorado liso).]
  *   **Arreglos Florales:** [Disposición (ej. central, dispersa), flores principales (tipos, colores), follaje. Confirmar presencia/ubicación de ROSAS ESPECÍFICAS sobre el arreglo, si son visibles y dónde. Contenedores (tipo, material, color).]
  *   **Decoración Específica:** [Velas (tipo, soportes), pista de baile (forma, base, patrón), iniciales (material, posición), si son visibles.]
  *   **Fondo Inmediato (detrás de mesa principal/escenario):** [Elementos (ej. podios, paneles), colores, materiales.]
  *   **Fondo Distante (a través de ventanas/fondo abierto):** [Paisaje, nivel de detalle (ej. difuminado).]
  *   **Materiales Clave para Renderizado:** [Lista concisa de materiales principales que se deben aplicar.]

  Tu respuesta DEBE COMENZAR con: "Descripción técnica de la escena (1:1 SketchUp):"
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
    ? `**DIRECTIVA CRÍTICA: REFERENCIAS VISUALES ANULAN TEXTO EN CONFLICTO** Si se proporcionan imágenes de referencia visuales específicas para elementos (ej. cubiertos, flores, servilletas) junto con este prompt, la IA **DEBE priorizar y replicar los detalles visuales, patrones y texturas EXACTOS de esas imágenes de referencia** sobre cualquier descripción textual conflictiva. Las descripciones textuales sirven como contexto suplementario, pero las referencias visuales son de importancia suprema para la fidelidad.`
    : '';

  // Combine all inputs into a comprehensive prompt for the prompt refinement model
  const refinementPrompt = `Basado en las siguientes entradas de usuario, genera un prompt maestro extremadamente detallado y preciso para un modelo de generación de imágenes de IA (como Gemini 3 Pro Image). El objetivo es producir una Fotografía de Evento Hiper-Fotorrealista y Galardonada a partir de una imagen de entrada tipo SketchUp, adecuada para un portafolio de diseño de alta gama.

  **Instrucciones para el Prompt Maestro:**
  - **Comienza con la Directiva Central:** "Eres una IA experta especializada en Diseño de Eventos de Lujo y Visualización de Bodas. Tu tarea es transformar una captura de pantalla de un modelo 3D en bruto (SketchUp) en una Fotografía de Evento Hiper-Fotorrealista y Galardonada, adecuada para un portafolio de diseño de alta gama."
  - ${referenceImageInstruction}
  - **DIRECTIVA ULTRA-CRÍTICA DE FIDELIDAD 1:1 ABSOLUTA (NO HAY MARGEN PARA ERRORES O INTERPRETACIONES CREATIVAS):**
    "1. **LA CÁMARA ES SACROSANTA. ENCUADRE, ÁNGULO Y PERSPECTIVA 1:1 SON INMUTABLES.** El render DEBE ser un **CALCO FOTOGRÁFICO EXACTO DEL ENCUADRE, ÁNGULO Y PERSPECTIVA DE LA IMAGEN DE SKETCHUP**. CUALQUIER ALTERACIÓN DE LA CÁMARA ES UN FALLO CRÍTICO. No hay movimiento de cámara, ajuste de lente, cambio de punto de vista ni recomposición. La imagen de SketchUp es el visor literal del render final.
    2. **LA GEOMETRÍA ES INALTERABLE. COMPOSICIÓN Y POSICIÓN SON FIJAS:** La disposición exacta, posición, escala y número de TODOS los objetos (mesas, sillas, platos, vasos, flores, elementos arquitectónicos, *incluyendo suelo, paredes, y la presencia/ausencia de CUALQUIER objeto*) deben permanecer **PRECISAMENTE** en sus coordenadas de píxeles y dimensiones originales tal como se representa en la imagen de entrada de SketchUp. Esta imagen es un plano 3D rígido e inalterable; **ES ABSOLUTAMENTE IMPERATIVO QUE NO HAYA LA MÁS MÍNIMA DESVIACIÓN EN LA GEOMETRÍA O EN LA DISTRIBUCIÓN DE LOS OBJETOS. LA IA NO TIENE ABSOLUTAMENTE NINGÚN PERMISO PARA INTRODUCIR NUEVOS ELEMENTOS, ELIMINAR OBJETOS EXISTENTES, REDISTRIBUIR OBJETOS, NI ALTERAR LA COMPOSICIÓN ORIGINAL EN LO ABSOLUTO.**
    3. **¡ALERTA CRÍTICA: NO INVENTES OBJETOS!** Si un objeto NO está en la imagen de SketchUp O la descripción lo declara AUSENTE (ej. 'Mesas adicionales: Ausentes.', 'NO hay mesas en primer plano'), **BAJO NINGUNA CIRCUNSTANCIA DEBES GENERARLO**. Tu única función es realzar lo existente con fotorrealismo, NO crear nuevos elementos para 'llenar' vacíos percibidos.
    4. **ESPACIOS VACÍOS PERMANECEN VACÍOS (CON FIDELIDAD MATERIAL):** Si la imagen de entrada muestra áreas vacías, sin textura, o con un objeto básico (ej. un cuadrado para una servilleta), estas áreas DEBEN permanecer como tales. NO añadas nuevas paredes, techos, muebles o cualquier elemento arquitectónico no presente explícitamente en la imagen de SketchUp, y **NUNCA inventes objetos o mobiliario para llenar estos espacios, incluso si parecen 'vacíos'.** Trata las superficies sin textura como fondos simples, limpios y consistentemente de tono neutro si lo sugiere el contexto (ej. 'pared lisa con micro-textura de yeso blanco sin patrón'), pero NUNCA inventes patrones o estructuras complejas.
    5. **SÓLO SUPERPOSICIÓN DE TEXTURA FOTORREALISTA (FIDELIDAD 1:1 DE OBJETO Y FORMA):** Tu ÚNICA función es 'pintar' sobre la geometría existente con texturas y materiales increíblemente realistas, de alta definición, renderizados físicamente (PBR). NO alteres las formas subyacentes, solo sus propiedades de superficie y la interacción con la luz. SI LA IMAGEN DE SKETCHUP ES UN 'MODELO DE CAJA BLANCA' O UN 'LAYOUT BÁSICO' CON ESPACIOS VACÍOS, ASEGÚRATE DE QUE LA IMAGEN FINAL REFLEJE UN ESPACIO ABIERTO, O LAS PAREDES TAL CUAL, SIN AÑADIR NUEVAS PAREDES INNECESARIAS O RELLENAR VACÍOS CON ESTRUCTURAS. **Cada objeto, por pequeño que sea (platos, cubiertos, copas, servilletas, flores específicas), DEBE mantener la forma, tamaño, posición, color, patrón y doblado EXACTOS de la geometría original de SketchUp. Si una servilleta es cuadrada en SketchUp, DEBE ser cuadrada en el render y su doblado DEBE ser el mismo; si un plato tiene un borde específico, DEBE replicarlo. NO 'MEJORES' CREATIVAMENTE SU GEOMETRÍA. Solo haz que se vean fotorrealistas con la fidelidad más alta posible a su forma base, SIN INFERIR NADA QUE NO ESTÉ EN EL SKETCHUP.**"
  - **Protocolo Detallado de Traducción de Materiales (Basado en la Descripción de Elementos de la Escena y Referencias Visuales):**
    - **Detalles del Contenido de la Escena:** Incorpora TODOS los detalles de la descripción de la escena a continuación. Esto incluye estilo general, colores dominantes, objetos específicos, sus recuentos, descripciones detalladas (ej. tipos y colores específicos de flores, estilos de sillas, tipos de tela, materiales de la vajilla, *con notas específicas sobre el grano de la madera, el tejido de la tela, los acabados metálicos*). La IA debe seguir estrictamente estas descripciones, **priorizando las referencias visuales si se proporcionan para cualquier elemento específico**.
    - **Florales:** "Renderízalos como diseños florales hiper-realistas, recién arreglados, exuberantes y orgánicos. Incorpora TODOS los detalles de flores proporcionados por el usuario (tipos, colores, arreglos, estilos de jarrones) de la descripción de la escena. Concéntrate en detalles de pétalos individuales, naturalmente imperfectos, texturas variadas, volumen realista, variaciones orgánicas y translucidez de luz realista. Asegura que el color sea exactamente el especificado. **SI SE ESPECIFICAN ROSAS U OTRAS FLORES SOBRE UN ARREGLO, DEBEN ESTAR PRESENTES Y EN LA POSICIÓN EXACTA, REPLICANDO LA DISPOSICIÓN DEL SKETCHUP. Si se proporcionan referencias visuales para flores/jarrones, replícalas con precisión, incluyendo propiedades de material y forma.**"
    - **Telas:** "Transforma superficies de colores planos en textiles lujosos de alta gama. Incorpora TODOS los detalles de tela proporcionados por el usuario de la descripción de la escena. Renderiza con **cualidades de renderizado físicamente basado (PBR) hiper-realistas**: exhibiendo pliegues de tela naturales, suaves y voluminosos y peso natural, brillo sutil y detalles intrincados del tejido (ej. seda fina, terciopelo pesado, lino nítido, brocado texturizado). Asegura que la luz interactúe de forma realista con la siesta y la textura de la tela, mostrando sutiles variaciones de color y brillo. **Si se proporcionan referencias visuales para telas, replícalas con precisión, incluyendo la caída y la textura.**"
    - **Vajilla (Vasos, Cubiertos, Platos, Servilletas):** "Convierte formas geométricas en vajilla exquisita. Incorpora TODOS los detalles de vajilla y servilletas proporcionados por el usuario de la descripción de la escena. Esto incluye **cubiertos de metal dorado ALTAMENTE PULIDO, BRILLANTE Y ALTAMENTE REFLECTANTE (con un lustre vívido, un efecto espejo casi perfecto, un brillo casi especular que refleja el entorno con máxima fidelidad y sutiles iridiscencias), con micro-rasguños sutiles y distribución de peso realista)**; **platos de porcelana fina (esmaltes delicados, bordes nítidos, imperfecciones sutiles, micro-textura de superficie realista y cualquier patrón o detalle de borde especificado). LA VAJILLA Y SERVILLETAS DEBEN REPLICAR FIELMENTE LAS FORMAS, TAMAÑOS, PATRONES, COLORES Y DOBLADOS EXACTOS MOSTRADOS EN EL SKETCHUP O EN LAS REFERENCIAS. ABSOLUTAMENTE NINGUNA ALTERACIÓN, MODIFICACIÓN O 'MEJORAMIENTO' CREATIVO DE SU GEOMETRÍA O DISPOSICIÓN, incluso si el modelo de SketchUp es rudimentario; tu tarea es añadir fotorrealismo A SU GEOMETRÍA EXISTENTE Y EXACTA SIN INFERENCIAS**."; y **cristalería brillante e impecable (exhibiendo refracciones ópticas realistas, aberración cromática y alta transparencia, reflejando la luz ambiental con reflejos precisos pero SIN destellos de lente exagerados, deslumbramiento o floración de fuentes de luz internas)**. Cada pequeño detalle debe ser renderizado perfectamente. **Si se proporcionan referencias visuales para vajilla/servilletas, replícalas con precisión, incluyendo propiedades de material, patrones y formas.**"
    - **Sillas:** "Aplica texturas fotorrealistas. Incorpora TODOS los detalles de sillas proporcionados por el usuario de la descripción de la escena. Ejemplos incluyen sillas Chivari doradas ricamente texturizadas con brillo metálico realista, reflejos precisos y desgaste sutil; sillas Crossback de madera rústicas con grano de madera visible y variado (ej. roble, caoba, pino envejecido), imperfecciones naturales y acabados de superficie realistas (ej. mate, satinado); o sillas Ghost de acrílico perfectamente claras con alta transparencia, interacción de luz realista (refracción y reflexión) y reflejos sutiles en los bordes. **Si se proporcionan referencias visuales para sillas, replícalas con precisión.**"
  - **Guía de Atmósfera y Estilo:**
    - **Inferencia General de Estilo y Material:** La descripción de la escena es CRÍTICA para especificar elecciones exactas de materiales, tipos y colores de flores específicos y elementos decorativos matizados, así como el estilo general del evento. La IA priorizará estos detalles textuales para la precisión del renderizado, *mientras se adhiere rigurosamente a la geometría original, las indicaciones de color y el diseño de la imagen de SketchUp*, **y dando importancia primordial a cualquier referencia visual proporcionada para elementos específicos**."
    - **Entorno de Iluminación (Físicamente Preciso):** "${lightingDetails} ${advancedLightingCommand}"
  - **Calidad:** "Genera una imagen con fotorrealismo inigualable y detalle sub-píxel, renderizada en resolución 8K. Utiliza interacción de luz físicamente precisa, profundidad de campo precisa (creando un efecto bokeh natural para los elementos de fondo) y enfoque nítido en el primer plano inmediato y los sujetos principales. Asegura una caída de luz natural y sombras realistas sin artefactos de lente artificiales (sin destellos, deslumbramiento o floración artificial a menos que sea un subproducto sutil y físicamente preciso de las condiciones de iluminación)."
  - **Directiva de Salida:** "Output: Return ONLY the final rendered image."

  **Descripción de Elementos de la Escena (ESTA ES LA FUENTE PRIMARIA E INALTERABLE DE TODOS LOS DETALLES DE CONTENIDO Y GEOMETRÍA PARA ESTA ESCENA):**
  \`\`\`
  ${sceneElementsDescription}
  \`\`\`
  ${hasReferenceImages ? "- Nota: También se proporcionan referencias visuales globales para elementos específicos junto a CADA imagen principal de SketchUp. Prioriza estas señales visuales para esos elementos en todas las generaciones." : ""}

  Genera el prompt maestro completo y refinado ahora:`;

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

    onProgress(`Generando render para la escena...`);
    const imageUrl = await generateEventRender(
      sketchupImage,
      finalPrompt,
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