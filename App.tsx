import React, { useState, useCallback, useEffect, useRef } from 'react';
import { detectSceneElements, generateSingleRender } from './services/geminiService'; // Changed import
import LoadingSpinner from './components/LoadingSpinner';
import { LightingType, LightingConfig } from './types'; // Added LightingConfig

const App: React.FC = () => {
  // States for the single uploaded SketchUp scene
  const [uploadedSketchupScene, setUploadedSketchupScene] = useState<File | null>(null);
  const [sketchupScenePreview, setSketchupScenePreview] = useState<string | null>(null);

  // Scene-specific description (replaces globalSceneDescription)
  const [sceneDescription, setSceneDescription] = useState<string>('');
  const [isDetectingScene, setIsDetectingScene] = useState<boolean>(false); // Renamed

  // Scene-specific reference images (replaces globalReferenceImages)
  const [referenceImages, setReferenceImages] = useState<File[]>([]);
  const [referenceImagePreviews, setReferenceImagePreviews] = useState<{file: File, url: string}[]>([]);
  const MAX_REFERENCE_IMAGES = 5; // Define maximum limit for reference images (increased from 3 to 5)

  // Lighting configuration
  const [lightingType, setLightingType] = useState<LightingType>(LightingType.Day);
  // New lighting states with default values
  const [colorTemperature, setColorTemperature] = useState<LightingConfig['colorTemperature']>('neutral');
  const [exposureCompensation, setExposureCompensation] = useState<LightingConfig['exposureCompensation']>('standard');
  const [contrastEnhancement, setContrastEnhancement] = useState<LightingConfig['contrastEnhancement']>('natural');

  const [advancedLightingInstructions, setAdvancedLightingInstructions] = useState<string>('');
  
  // Single render result (replaces generatedSceneUrls)
  const [generatedRender, setGeneratedRender] = useState<{ url: string | null; error: string | null } | null>(null);

  // UI/Loading States
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [currentGenerationProgress, setCurrentGenerationProgress] = useState<string>('');

  // Error and API Key Management
  const [error, setError] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean>(false);
  const [showApiKeyPrompt, setShowApiKeyPrompt] = useState<boolean>(false); // Corrected state setter

  // Refs to file inputs for triggering clicks and loading lighting config
  const sketchupFileInputRef = useRef<HTMLInputElement>(null);
  const referenceFileInputRef = useRef<HTMLInputElement>(null);
  const lightingConfigFileInputRef = useRef<HTMLInputElement>(null); // New ref for lighting config

  const checkApiKey = useCallback(async () => {
    if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
      const selected = await window.aistudio.hasSelectedApiKey();
      setHasApiKey(selected);
      setShowApiKeyPrompt(!selected); // Corrected state setter
    } else {
      setHasApiKey(true); // Assume API key is configured via process.env.API_KEY for local dev
      setShowApiKeyPrompt(false); // Corrected state setter
    }
  }, []);

  useEffect(() => {
    checkApiKey();
  }, [checkApiKey]);

  const handleSelectApiKey = useCallback(async () => {
    if (window.aistudio && typeof window.aistudio.openSelectKey === 'function') {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
      setShowApiKeyPrompt(false); // Corrected state setter
      setError(null);
    } else {
      setError("AI Studio API not available for key selection. Please ensure API_KEY is set in your environment.");
    }
  }, []);

  const handleSketchupFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      // Add explicit type assertion for `File` to ensure type consistency
      const file = event.target.files[0] as File;
      setUploadedSketchupScene(file);
      setSketchupScenePreview(URL.createObjectURL(file));

      // Reset scene-specific states when a new image is uploaded
      setSceneDescription('');
      setIsDetectingScene(false);
      setReferenceImages([]);
      setReferenceImagePreviews([]);
      // Keep lighting settings as they might be imported or user-defined for the next scene
      setGeneratedRender(null);
      setError(null);
    } else {
      // Clear states if no file is selected (e.g., user cancels file dialog)
      setUploadedSketchupScene(null);
      setSketchupScenePreview(null);
    }
  }, []);

  const handleSceneDescriptionChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setSceneDescription(event.target.value);
  }, []);

  const handleReferenceImagesChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const currentRefImagesCount = referenceImages.length;
      const filesToProcess = Array.from(event.target.files) as File[];
      
      const newImages = filesToProcess.slice(0, MAX_REFERENCE_IMAGES - currentRefImagesCount);
      
      if (newImages.length > 0) {
        setReferenceImages(prev => [...prev, ...newImages]);
        const newPreviews = newImages.map(file => ({
          file,
          url: URL.createObjectURL(file)
        }));
        setReferenceImagePreviews(prev => [...prev, ...newPreviews]);
      }

      if (currentRefImagesCount + filesToProcess.length > MAX_REFERENCE_IMAGES) {
        setError(`Solo se permiten un máximo de ${MAX_REFERENCE_IMAGES} imágenes de referencia. Se han añadido las primeras ${newImages.length}.`);
      } else {
        setError(null);
      }
      
      // Clear the file input value to allow selecting the same file(s) again if needed
      if (referenceFileInputRef.current) {
        referenceFileInputRef.current.value = '';
      }
    }
  }, [referenceImages, MAX_REFERENCE_IMAGES]);

  const handleRemoveReferenceImage = useCallback((fileToRemove: File) => {
    setReferenceImages(prev => prev.filter(file => file !== fileToRemove));
    setReferenceImagePreviews(prev => prev.filter(preview => preview.file !== fileToRemove));
    setError(null); // Clear any previous limit error if an image is removed
  }, []);

  const handleLightingTypeChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setLightingType(event.target.value as LightingType);
  }, []);

  // New handlers for advanced lighting controls
  const handleColorTemperatureChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setColorTemperature(event.target.value as LightingConfig['colorTemperature']);
  }, []);

  const handleExposureCompensationChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setExposureCompensation(event.target.value as LightingConfig['exposureCompensation']);
  }, []);

  const handleContrastEnhancementChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setContrastEnhancement(event.target.value as LightingConfig['contrastEnhancement']);
  }, []);

  const handleAdvancedLightingChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setAdvancedLightingInstructions(event.target.value);
  }, []);

  const handleDetectSceneElements = useCallback(async () => { // Renamed handler
    if (!uploadedSketchupScene) {
      setError('Por favor, sube una imagen de SketchUp para detectar elementos.');
      return;
    }
    if (!hasApiKey) {
      setShowApiKeyPrompt(true); // Corrected state setter
      setError('Por favor, selecciona tu clave API antes de detectar elementos.');
      return;
    }

    setIsDetectingScene(true);
    setError(null);
    setSceneDescription(''); // Clear previous description

    try {
      const detected = await detectSceneElements([uploadedSketchupScene]); // Pass single image in array
      setSceneDescription(detected);
    } catch (err: any) {
      console.error('Error detecting scene elements:', err);
      if (err.message && err.message.includes("Requested entity was not found.")) {
        setError(`${err.message} Un enlace a la documentación de facturación se puede encontrar en ai.google.dev/gemini-api/docs/billing.`);
        setHasApiKey(false);
        setShowApiKeyPrompt(true); // Corrected state setter
      } else {
        setError(`Fallo al detectar elementos de la escena: ${err.message || 'Error desconocido'}.`);
      }
    } finally {
      setIsDetectingScene(false);
    }
  }, [uploadedSketchupScene, hasApiKey]);

  const handleGenerateRender = useCallback(async () => { // Renamed handler
    if (!uploadedSketchupScene) {
      setError('Por favor, sube una imagen de SketchUp.');
      return;
    }
    if (!sceneDescription.trim()) {
      setError('Por favor, detecta o describe los elementos de la escena.');
      return;
    }
    if (!hasApiKey) {
      setShowApiKeyPrompt(true); // Corrected state setter
      setError('Por favor, selecciona tu clave API antes de generar el render.');
      return;
    }

    setIsLoading(true);
    setGeneratedRender(null); // Reset previous render
    setError(null);
    setCurrentGenerationProgress('Iniciando generación...');

    try {
      const result = await generateSingleRender( // Call single render function
        uploadedSketchupScene,
        sceneDescription,
        referenceImages,
        lightingType,
        advancedLightingInstructions,
        colorTemperature, // Pass new lighting parameters
        exposureCompensation,
        contrastEnhancement,
        (message) => { // Simplified callback
          setCurrentGenerationProgress(message);
        }
      );
      setGeneratedRender(result);
      if (result.error) {
        setCurrentGenerationProgress(`Generación fallida: ${result.error}`);
      } else {
        setCurrentGenerationProgress('Generación completada.');
      }
    } catch (err: any) {
      console.error('Error generating event render:', err);
      const generalErrorMessage = err.message && err.message.includes("Requested entity was not found.")
        ? `${err.message} Un enlace a la documentación de facturación se puede encontrar en ai.google.dev/gemini-api/docs/billing.`
        : `Fallo general al generar el render: ${err.message || 'Error desconocido'}. Por favor, inténtalo de nuevo.`;
      
      setError(generalErrorMessage);
      if (err.message && err.message.includes("Requested entity was not found.")) {
        setHasApiKey(false);
        setShowApiKeyPrompt(true); // Corrected state setter
      }
      setCurrentGenerationProgress('');
    } finally {
      setIsLoading(false);
    }
  }, [uploadedSketchupScene, sceneDescription, referenceImages, lightingType, advancedLightingInstructions, colorTemperature, exposureCompensation, contrastEnhancement, hasApiKey]);

  const handleDownloadImage = useCallback(() => { // Changed from download all
    if (generatedRender?.url) {
      const link = document.createElement('a');
      link.href = generatedRender.url;
      link.download = `event_render.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }, [generatedRender]);

  const handleSaveLightingConfig = useCallback(() => {
    const config: LightingConfig = {
      lightingType,
      advancedLightingInstructions,
      colorTemperature, // Include new parameters
      exposureCompensation,
      contrastEnhancement,
    };
    const json = JSON.stringify(config, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'lighting_config.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [lightingType, advancedLightingInstructions, colorTemperature, exposureCompensation, contrastEnhancement]);

  const handleLoadLightingConfig = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const file = event.target.files[0];
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const config: LightingConfig = JSON.parse(content);
          // Check for all required lighting properties
          if (config.lightingType && config.advancedLightingInstructions !== undefined &&
              config.colorTemperature && config.exposureCompensation && config.contrastEnhancement) {
            setLightingType(config.lightingType);
            setAdvancedLightingInstructions(config.advancedLightingInstructions);
            setColorTemperature(config.colorTemperature); // Set new parameters
            setExposureCompensation(config.exposureCompensation);
            setContrastEnhancement(config.contrastEnhancement);
            setError(null);
          } else {
            throw new Error('Formato de configuración de iluminación no válido o incompleto.');
          }
        } catch (parseError: any) {
          setError(`Error al cargar la configuración de iluminación: ${parseError.message || 'Archivo JSON corrupto.'}`);
        }
      };
      reader.onerror = () => {
        setError('Error al leer el archivo de configuración.');
      };
      reader.readAsText(file);
    }
  }, []);

  const handleStartNewScene = useCallback(() => {
    // Clear all scene-specific states
    setUploadedSketchupScene(null);
    setSketchupScenePreview(null);
    if (sketchupFileInputRef.current) sketchupFileInputRef.current.value = ''; // Clear file input
    
    setSceneDescription('');
    setIsDetectingScene(false);
    setReferenceImages([]);
    setReferenceImagePreviews([]);
    if (referenceFileInputRef.current) referenceFileInputRef.current.value = ''; // Clear file input
    
    setGeneratedRender(null);
    setError(null);
    setCurrentGenerationProgress('');
    // Keep lightingType and advancedLightingInstructions, colorTemperature, exposureCompensation, contrastEnhancement as they are, allowing reuse
  }, []);


  return (
    <div className="container mx-auto p-4 md:p-8 bg-gradient-to-br from-indigo-800 to-purple-800 rounded-xl shadow-2xl max-w-4xl border border-indigo-700">
      <h1 className="text-4xl md:text-5xl font-extrabold text-center mb-6 text-transparent bg-clip-text bg-gradient-to-r from-pink-300 via-purple-300 to-indigo-300">
        Event Render AI
      </h1>
      <p className="text-center text-lg text-indigo-200 mb-8 max-w-2xl mx-auto">
        Transforma un diseño de SketchUp en un render fotorrealista de evento, con configuración de iluminación reutilizable.
      </p>

      {showApiKeyPrompt && (
        <div className="bg-yellow-800/30 border border-yellow-600 rounded-lg p-4 mb-6 text-yellow-100 text-center flex flex-col items-center">
          <p className="mb-3 text-lg font-semibold">
            Por favor, selecciona una clave API de un proyecto GCP de pago para usar los modelos de generación de imágenes de alta calidad.
          </p>
          <button
            onClick={handleSelectApiKey}
            className="py-2 px-6 bg-yellow-600 hover:bg-yellow-700 text-white font-bold rounded-full transition duration-300 ease-in-out shadow-md"
          >
            Seleccionar clave API
          </button>
          <p className="mt-2 text-sm">
            Documentación de facturación: <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="underline hover:text-yellow-300">ai.google.dev/gemini-api/docs/billing</a>
          </p>
        </div>
      )}

      {error && (
        <div className="mt-8 p-4 bg-red-800 border border-red-600 rounded-lg text-red-100 text-center font-medium">
          <p>{error}</p>
        </div>
      )}

      {/* STAGE 1: Upload Single SketchUp Scene */}
      <section className="space-y-6 mb-8 p-6 bg-indigo-800/30 rounded-lg border border-indigo-700">
        <h2 className="text-2xl font-bold text-indigo-100">1. Carga tu Escena de SketchUp</h2>
        <p className="text-indigo-200">
          Sube una captura de pantalla de SketchUp para tu evento.
        </p>
        <label htmlFor="sketchup-single-upload" className="block text-lg font-medium text-indigo-200 mb-3 cursor-pointer hover:text-indigo-100 transition duration-200">
          Seleccionar archivo de SketchUp
        </label>
        <input
          id="sketchup-single-upload"
          type="file"
          accept="image/*"
          onChange={handleSketchupFileChange}
          ref={sketchupFileInputRef}
          className="hidden"
        />
        <button
          onClick={() => sketchupFileInputRef.current?.click()}
          className="w-full py-3 px-6 rounded-full bg-indigo-600 text-white text-lg font-bold shadow-md hover:bg-indigo-700 transition duration-300 ease-in-out"
        >
          {uploadedSketchupScene ? `Cambiar Archivo (${uploadedSketchupScene.name})` : 'Subir Escena de SketchUp'}
        </button>

        {sketchupScenePreview && (
          <div className="mt-8 bg-indigo-900/40 p-5 rounded-lg border border-indigo-700 shadow-lg">
            <h3 className="text-xl font-semibold text-indigo-100 mb-4">Escena Cargada: {uploadedSketchupScene?.name}</h3>
            <img src={sketchupScenePreview} alt="SketchUp Scene Preview" className="w-full h-auto object-cover rounded-md mb-4 border border-indigo-600" />
          </div>
        )}
        {!sketchupScenePreview && (
          <div className="mt-4 p-6 border-2 border-dashed border-indigo-600 rounded-md text-indigo-400 text-center">
            <p>No se ha seleccionado ninguna escena de SketchUp.</p>
          </div>
        )}

        {uploadedSketchupScene && (
          <div className="mt-8 pt-6 border-t border-indigo-700">
            <h3 className="text-2xl font-bold text-indigo-100 mb-4">2. Detectar y Describir Elementos de la Escena</h3>
            <p className="text-indigo-200 mb-4">
              La IA analizará la escena cargada y generará una descripción técnica y factual, **respetando la cámara 1:1 y sin inventar nada**.
            </p>
            <button
              onClick={handleDetectSceneElements}
              disabled={isDetectingScene || !hasApiKey || !uploadedSketchupScene}
              className="w-full py-3 px-6 rounded-full bg-blue-600 text-white font-bold shadow-md hover:bg-blue-700 transition duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed mb-4"
            >
              {isDetectingScene ? 'Detectando elementos...' : 'Detectar Elementos de la Escena'}
            </button>
            {isDetectingScene && <LoadingSpinner />}

            {sceneDescription && (
              <div className="mt-4">
                <label htmlFor="scene-description" className="block text-lg font-semibold text-indigo-200 mb-2">
                  Descripción de la Escena (Edita para MÁXIMA precisión 1:1, técnica y sin invenciones)
                </label>
                <textarea
                  id="scene-description"
                  value={sceneDescription}
                  onChange={handleSceneDescriptionChange}
                  rows={10}
                  className="w-full p-3 rounded-lg bg-indigo-900 border border-indigo-700 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition duration-200 resize-y"
                  placeholder="EJEMPLO (formato técnico estricto, 1:1 con SketchUp en geometría, posición, presencia de objetos y cámara):
*   Cámara: Perspectiva fija, punto de vista ligeramente bajo y central, encuadre cerrado.
*   Suelo: Plano horizontal, mármol blanco con veteado gris.
*   Paredes: Planos verticales, yeso blanco liso.
*   Ventanas: Dos rectángulos con marcos negros, cristal transparente.
*   Techo: No visible.
*   Sillas (primer plano): 4 sillas Chivari, metal dorado pulido, cojines de terciopelo blanco.
*   Mesa (primer plano): NINGUNA. Mantener vacío.
*   Mesa (fondo): 1 mesa rectangular, superficie de mármol blanco con base cilíndrica dorada.
*   Platos: Redondos, porcelana blanca con borde dorado.
*   Cubiertos: Tenedor, cuchillo, metal dorado pulido.
*   Copas: Dos por puesto, cristal transparente, tallo fino.
*   Servilletas: Lino marfil, doblado en forma de moño, con anillo dorado liso.
*   Arreglos florales (mesa de fondo): Rosas blancas y rojas, peonías blush, eucalipto, en florero de cristal cilíndrico.
*   Velas (mesa de fondo): 3 velas cilíndricas encendidas, en soportes de cristal.
*   Fondo (detrás de la mesa): Paneles de madera clara.
*   Fondo distante (a través de ventanas): Jardín verde difuminado."
                ></textarea>
              </div>
            )}
          </div>
        )}
      </section>

      {/* STAGE 2: Define Scene-Specific Style References */}
      {sceneDescription.trim() !== '' && (
        <section className="space-y-6 mb-8 p-6 bg-indigo-800/30 rounded-lg border border-indigo-700">
          <h2 className="text-2xl font-bold text-indigo-100">3. Añadir Referencias Visuales (Opcional)</h2>
          <p className="text-indigo-200">
            Sube hasta {MAX_REFERENCE_IMAGES} imágenes de elementos específicos (ej. cubiertos, estilo de flores, textura de tela) para que la IA los replique con la máxima fidelidad en esta escena.
          </p>
          <label htmlFor="reference-image-upload" className="block text-lg font-medium text-indigo-200 mb-3 cursor-pointer hover:text-indigo-100 transition duration-200">
            Seleccionar imágenes de referencia
          </label>
          <input
            id="reference-image-upload"
            type="file"
            accept="image/*"
            multiple
            onChange={handleReferenceImagesChange}
            ref={referenceFileInputRef}
            className="hidden"
            disabled={referenceImages.length >= MAX_REFERENCE_IMAGES}
          />
          <button
            onClick={() => referenceFileInputRef.current?.click()}
            className="w-full py-3 px-6 rounded-full bg-blue-500 text-white text-lg font-bold shadow-md hover:bg-blue-600 transition duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={referenceImages.length >= MAX_REFERENCE_IMAGES}
          >
            {referenceImages.length > 0 ? `Añadir/Cambiar Referencias (${referenceImages.length}/${MAX_REFERENCE_IMAGES} Archivos)` : `Subir Referencias Visuales (Máx. ${MAX_REFERENCE_IMAGES})`}
          </button>
          {referenceImages.length >= MAX_REFERENCE_IMAGES && (
            <p className="text-yellow-300 text-sm mt-2 text-center">
              Has alcanzado el límite de {MAX_REFERENCE_IMAGES} imágenes de referencia. Elimina alguna para añadir nuevas.
            </p>
          )}

          {referenceImagePreviews.length > 0 && (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {referenceImagePreviews.map((preview, index) => (
                <div key={index} className="relative group border border-indigo-600 rounded-md overflow-hidden shadow-md">
                  <img src={preview.url} alt={`Reference ${index}`} className="w-full h-24 object-cover" />
                  <button
                    onClick={() => handleRemoveReferenceImage(preview.file)}
                    className="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label="Remove reference image"
                  >
                    ✕
                  </button>
                  <p className="text-xs text-indigo-300 p-1 truncate">{preview.file.name}</p>
                </div>
              ))}
            </div>
          )}
          {referenceImagePreviews.length === 0 && (
            <div className="mt-4 p-6 border-2 border-dashed border-indigo-600 rounded-md text-indigo-400 text-center">
              <p>No se han seleccionado imágenes de referencia.</p>
            </div>
          )}
        </section>
      )}

      {/* STAGE 3: Define Scene Lighting */}
      {sceneDescription.trim() !== '' && (
        <section className="space-y-6 mb-8 p-6 bg-indigo-800/30 rounded-lg border border-indigo-700">
          <h2 className="text-2xl font-bold text-indigo-100">4. Definir Iluminación de la Escena</h2>
          <p className="text-indigo-200">
            Esta iluminación se aplicará a tu escena de SketchUp.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 items-center mb-6">
            <label htmlFor="lighting-config-upload" className="block text-lg font-medium text-indigo-200 cursor-pointer hover:text-indigo-100 transition duration-200">
              Cargar Configuración de Iluminación:
            </label>
            <input
              id="lighting-config-upload"
              type="file"
              accept=".json"
              onChange={handleLoadLightingConfig}
              ref={lightingConfigFileInputRef}
              className="hidden"
            />
            <button
              onClick={() => lightingConfigFileInputRef.current?.click()}
              className="py-2 px-5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-full transition duration-300 ease-in-out shadow-md"
            >
              Cargar Archivo .json
            </button>
          </div>

          <div>
            <label htmlFor="lighting-type" className="block text-xl font-semibold text-indigo-200 mb-2">
              Tipo de Iluminación General
            </label>
            <select
              id="lighting-type"
              value={lightingType}
              onChange={handleLightingTypeChange}
              className="w-full p-3 rounded-lg bg-indigo-900 border border-indigo-700 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition duration-200 mb-4"
            >
              <option value={LightingType.Day}>Día (Brillante, natural, uniforme)</option>
              <option value={LightingType.Sunset}>Atardecer (Cálida, dorada, sombras largas)</option>
              <option value={LightingType.Night}>Noche (Luz de velas, ambiente tenue)</option>
            </select>
          </div>

          {/* New Advanced Lighting Controls */}
          <div>
            <label htmlFor="color-temperature" className="block text-xl font-semibold text-indigo-200 mb-2">
              Temperatura de Color
            </label>
            <select
              id="color-temperature"
              value={colorTemperature}
              onChange={handleColorTemperatureChange}
              className="w-full p-3 rounded-lg bg-indigo-900 border border-indigo-700 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition duration-200 mb-4"
            >
              <option value="neutral">Neutra (Equilibrada)</option>
              <option value="warm">Cálida (Tonos dorados/ámbar)</option>
              <option value="golden">Dorada (Muy cálida, atardecer)</option>
              <option value="cool">Fría (Tonos azules/cian)</option>
            </select>
          </div>

          <div>
            <label htmlFor="exposure-compensation" className="block text-xl font-semibold text-indigo-200 mb-2">
              Compensación de Exposición
            </label>
            <select
              id="exposure-compensation"
              value={exposureCompensation}
              onChange={handleExposureCompensationChange}
              className="w-full p-3 rounded-lg bg-indigo-900 border border-indigo-700 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition duration-200 mb-4"
            >
              <option value="standard">Estándar</option>
              <option value="brighter">Ligeramente Más Brillante</option>
              <option value="very_bright">Muy Brillante</option>
              <option value="darker">Ligeramente Más Oscura</option>
              <option value="very_dark">Muy Oscura</option>
            </select>
          </div>

          <div>
            <label htmlFor="contrast-enhancement" className="block text-xl font-semibold text-indigo-200 mb-2">
              Mejora de Contraste
            </label>
            <select
              id="contrast-enhancement"
              value={contrastEnhancement}
              onChange={handleContrastEnhancementChange}
              className="w-full p-3 rounded-lg bg-indigo-900 border border-indigo-700 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition duration-200 mb-4"
            >
              <option value="natural">Natural</option>
              <option value="enhanced">Mejorado (Más vivo)</option>
              <option value="high_contrast">Alto Contraste (Dramático)</option>
              <option value="soft">Suave (Etéreo)</option>
              <option value="low_contrast">Bajo Contraste (Plano, elegante)</option>
            </select>
          </div>


          <div>
            <label htmlFor="advanced-lighting" className="block text-xl font-semibold text-indigo-200 mb-2">
              Instrucciones de Iluminación Avanzada (Opcional y PUNTUAL)
            </label>
            <textarea
              id="advanced-lighting"
              value={advancedLightingInstructions}
              onChange={handleAdvancedLightingChange}
              rows={3}
              className="w-full p-3 rounded-lg bg-indigo-900 border border-indigo-700 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition duration-200 resize-y"
              placeholder="EJEMPLO: 'Proyectar spotlights blancos y ajustados sobre cada centro de mesa, creando círculos de luz definidos. Añadir tiras de LED cálidas y difusas detrás de los arreglos de madera en los cubículos del fondo, generando un halo suave. Evitar cualquier flare o glare artificial. Las velas deben tener un brillo suave sin efectos de lente exagerados.'"
            ></textarea>
          </div>
        </section>
      )}

      {/* STAGE 4: Generate Photorealistic Render */}
      {sceneDescription.trim() !== '' && (
        <section className="space-y-6 mb-8 p-6 bg-indigo-800/30 rounded-lg border border-indigo-700">
          <h2 className="text-2xl font-bold text-indigo-100">5. Generar Render Fotorrealista</h2>
          <p className="text-indigo-200">
            Haz clic para aplicar la descripción de la escena, las referencias visuales y la iluminación para generar tu render.
          </p>
          <button
            type="button"
            onClick={handleGenerateRender}
            disabled={isLoading || !uploadedSketchupScene || !sceneDescription.trim() || !hasApiKey}
            className="w-full py-4 px-6 rounded-full bg-gradient-to-r from-pink-500 to-purple-600 text-white text-2xl font-bold shadow-lg hover:from-pink-600 hover:to-purple-700 transition duration-300 ease-in-out transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:from-gray-500 disabled:to-gray-700"
          >
            {isLoading ? 'Generando Render...' : 'Generar Render Fotorrealista'}
          </button>
          {isLoading && currentGenerationProgress && (
            <div className="mt-4 text-center text-indigo-300 text-lg">
              <LoadingSpinner />
              <p>{currentGenerationProgress}</p>
            </div>
          )}
        </section>
      )}

      {/* Rendered Output Display */}
      {generatedRender && (
        <div className="mt-8 pt-8 border-t border-indigo-700">
          <h2 className="text-3xl md:text-4xl font-extrabold text-center mb-6 text-transparent bg-clip-text bg-gradient-to-r from-green-300 via-blue-300 to-teal-300">
            Tu Escena Renderizada
          </h2>
          <div className="relative border border-indigo-600 rounded-lg shadow-xl overflow-hidden">
            {generatedRender.url ? (
              <img
                src={generatedRender.url}
                alt={`Generated Render Scene`}
                className="w-full h-auto object-cover max-h-[60vh]"
              />
            ) : (
              <div className="w-full h-[40vh] flex flex-col items-center justify-center bg-gray-900 text-red-300 p-4">
                <p className="font-bold text-lg mb-2">Error al generar la escena:</p>
                <p className="text-sm text-center">{generatedRender.error || 'Error desconocido'}</p>
              </div>
            )}
            <p className="text-center text-sm text-indigo-300 mt-2">Render Final</p>
          </div>

          {generatedRender.url && (
            <p className="text-center text-sm text-indigo-300 mt-4">
              *Nota: Las imágenes generadas por IA pueden contener imperfecciones.
            </p>
          )}

          <div className="flex justify-center flex-wrap gap-4 mt-6">
            {generatedRender.url && (
              <button
                onClick={handleDownloadImage}
                className="py-3 px-8 bg-purple-700 text-white font-bold rounded-full shadow-lg hover:bg-purple-800 transition duration-300 ease-in-out transform hover:scale-105"
              >
                Descargar Imagen Generada
              </button>
            )}
            {generatedRender.url && (
              <button
                onClick={handleSaveLightingConfig}
                className="py-3 px-8 bg-green-600 text-white font-bold rounded-full shadow-lg hover:bg-green-700 transition duration-300 ease-in-out transform hover:scale-105"
              >
                Guardar Configuración de Iluminación
              </button>
            )}
            <button
              onClick={handleStartNewScene}
              className="py-3 px-8 bg-indigo-600 text-white font-bold rounded-full shadow-lg hover:bg-indigo-700 transition duration-300 ease-in-out transform hover:scale-105"
            >
              Comenzar Nueva Escena
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;