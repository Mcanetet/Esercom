/**
 * Aprendizaje por chat: el entrenador escribe "guarda esto" y la corrección
 * queda como conocimiento (regla pregunta → respuesta) o como nota del cerebro.
 */

const GATILLOS = [
  'guarda', 'guardalo', 'guardala', 'guardar', 'guardame',
  'aprende', 'aprendelo', 'aprendete', 'aprender',
  'recuerda', 'recuerdalo', 'memoriza', 'memorizalo',
  'anota', 'anotalo', 'registra', 'registralo',
  'corrige', 'corrigelo', 'correccion'
];

function normalizar(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * ¿El mensaje pide guardar conocimiento?
 * Devuelve null si no, o { destino, respuesta, pregunta } si sí.
 */
function detectarIntencionGuardar(message) {
  const raw = String(message || '').trim();
  if (!raw) return null;
  const norm = normalizar(raw);

  // Debe empezar con el gatillo (o "por favor guarda…") para no confundirse
  // con preguntas normales que mencionen la palabra.
  const inicio = norm.replace(/^(por favor|porfa|oye|angel|hola)[\s,]+/i, '');
  const gatillo = GATILLOS.find((g) => new RegExp(`^${g}\\b`).test(inicio));
  if (!gatillo) return null;

  const destino = /\b(cerebro|nota|documento|archivo)\b/.test(norm) ? 'cerebro' : 'regla';

  // Formato explícito: P: ... R: ...
  const explicito = raw.match(/p\s*:\s*([\s\S]+?)\s*r\s*:\s*([\s\S]+)$/i);
  if (explicito) {
    return {
      destino,
      pregunta: explicito[1].trim(),
      respuesta: explicito[2].trim()
    };
  }

  // Contenido después del gatillo: "guarda que son 4 postes", "guarda: son 4 postes"
  const idx = norm.indexOf(gatillo);
  let resto = raw.slice(idx + gatillo.length);
  resto = resto
    .replace(/^[\s,:;.\-–—]+/, '')
    .replace(/^(esto|eso|esta correccion|la correccion|este dato|lo siguiente|como conocimiento|en el cerebro|como nota)\b[\s,:;.\-–—]*/i, '')
    .replace(/^(que|lo siguiente)\b[\s,:;.\-–—]*/i, '')
    .replace(/\b(en el cerebro|como conocimiento|como nota|por favor)\b/gi, '')
    .trim();

  return {
    destino,
    pregunta: null,
    respuesta: resto.length >= 8 ? resto : null
  };
}

/**
 * Reconstruye pregunta/respuesta usando el historial del sandbox.
 * historial: [{ rol, contenido }] en orden cronológico.
 */
function resolverDesdeHistorial(historial, intencion) {
  const items = Array.isArray(historial) ? historial : [];
  let pregunta = intencion.pregunta;
  let respuesta = intencion.respuesta;

  const idxUltimoAsistente = (() => {
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].rol === 'assistant') return i;
    }
    return -1;
  })();

  if (!pregunta) {
    // La pregunta original es el último mensaje del usuario antes de la respuesta errónea.
    const limite = idxUltimoAsistente >= 0 ? idxUltimoAsistente : items.length;
    for (let i = limite - 1; i >= 0; i--) {
      if (items[i].rol !== 'assistant') {
        pregunta = String(items[i].contenido || '').trim();
        break;
      }
    }
  }

  if (!respuesta) {
    // Sin texto tras el gatillo: la corrección es el último mensaje del usuario
    // posterior a la respuesta errónea.
    for (let i = items.length - 1; i > idxUltimoAsistente; i--) {
      if (items[i].rol !== 'assistant') {
        const cand = String(items[i].contenido || '').trim();
        if (cand.length >= 8 && !detectarIntencionGuardar(cand)) {
          respuesta = cand;
          break;
        }
      }
    }
  }

  return { pregunta: pregunta || null, respuesta: respuesta || null };
}

/** Agrega o reemplaza una regla pregunta → respuesta en el entrenamiento. */
async function guardarRegla(db, { pregunta, respuesta }) {
  const { getTrainingConfig, saveTrainingConfig } = require('./angel');
  const cfg = await getTrainingConfig(db);
  const ejemplos = Array.isArray(cfg.ejemplos) ? [...cfg.ejemplos] : [];
  const clave = normalizar(pregunta);
  const idx = ejemplos.findIndex((e) => normalizar(e.pregunta) === clave);
  const reemplazo = idx >= 0;
  if (reemplazo) {
    ejemplos[idx] = { pregunta, respuesta };
  } else {
    ejemplos.push({ pregunta, respuesta });
  }
  await saveTrainingConfig(db, {
    instrucciones: cfg.instrucciones,
    ejemplos,
    seguridad: {
      activa: cfg.seguridad?.activa !== false,
      prompt_personalizado: cfg.seguridad?.prompt_personalizado || '',
      ejemplos: cfg.seguridad?.ejemplos || []
    }
  });
  return { reemplazo, total: ejemplos.length };
}

/** Guarda la corrección como nota de texto en la carpeta del cerebro. */
async function guardarNotaCerebro(db, { pregunta, respuesta, userId }) {
  const { addAngelTextNote } = require('./angel-docs');
  const titulo = pregunta
    ? `Corrección: ${String(pregunta).slice(0, 80)}`
    : `Nota del chat ${new Date().toLocaleDateString('es-CL')}`;
  const texto = pregunta
    ? `Pregunta: ${pregunta}\n\nRespuesta correcta: ${respuesta}`
    : respuesta;
  return addAngelTextNote(db, { titulo, texto, userId });
}

/**
 * Procesa el mensaje del sandbox. Si pide guardar, aprende y devuelve la
 * respuesta de confirmación; si no, devuelve null para seguir el flujo normal.
 */
async function procesarAprendizaje(db, { message, history, userId }) {
  const intencion = detectarIntencionGuardar(message);
  if (!intencion) return null;

  const { pregunta, respuesta } = resolverDesdeHistorial(history, intencion);

  if (!respuesta) {
    return {
      aprendido: false,
      reply: 'Quiero guardarlo, pero no tengo claro el texto correcto. '
        + 'Escríbelo así: «guarda: P: la pregunta R: la respuesta correcta», '
        + 'o escribe primero la corrección y luego «guarda eso».'
    };
  }

  if (intencion.destino === 'cerebro' || !pregunta) {
    const doc = await guardarNotaCerebro(db, { pregunta, respuesta, userId });
    return {
      aprendido: true,
      destino: 'cerebro',
      pregunta,
      respuesta,
      reply: `Guardado en el cerebro, tema «${doc.categoria_label}» (${doc.nombre}). `
        + 'Ya lo puedo usar al responder.'
    };
  }

  const res = await guardarRegla(db, { pregunta, respuesta });
  return {
    aprendido: true,
    destino: 'regla',
    pregunta,
    respuesta,
    reply: `${res.reemplazo ? 'Corrección actualizada' : 'Aprendido'}. Desde ahora, ante `
      + `«${String(pregunta).slice(0, 120)}» responderé:\n\n${respuesta}\n\n`
      + `(Guardado en Reglas de negocio, ${res.total} en total.)`
  };
}

module.exports = {
  detectarIntencionGuardar,
  resolverDesdeHistorial,
  procesarAprendizaje
};
