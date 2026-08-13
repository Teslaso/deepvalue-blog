import lzString from 'lz-string';

const COMPRESSED_JSON_RE = /```compressed-json\s*\r?\n([\s\S]*?)\r?\n```/u;

export class ExcalidrawFormatError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ExcalidrawFormatError';
  }
}

export function extractCompressedJson(markdown) {
  if (typeof markdown !== 'string') {
    throw new TypeError('Excalidraw Markdown must be a string');
  }

  const match = markdown.match(COMPRESSED_JSON_RE);
  if (!match) {
    throw new ExcalidrawFormatError('Excalidraw Markdown has no compressed-json block');
  }

  const payload = match[1].replace(/\s+/gu, '');
  if (payload === '') {
    throw new ExcalidrawFormatError('Excalidraw compressed-json block is empty');
  }
  return payload;
}

export function decodeExcalidrawMarkdown(markdown) {
  const compressed = extractCompressedJson(markdown);
  const decoded = lzString.decompressFromBase64(compressed);
  if (!decoded) {
    throw new ExcalidrawFormatError('Excalidraw compressed-json payload could not be decoded');
  }

  let scene;
  try {
    scene = JSON.parse(decoded);
  } catch (error) {
    throw new ExcalidrawFormatError('Decoded Excalidraw payload is not valid JSON', { cause: error });
  }

  if (!scene || scene.type !== 'excalidraw' || !Array.isArray(scene.elements)) {
    throw new ExcalidrawFormatError('Decoded payload is not an Excalidraw scene');
  }

  return {
    type: scene.type,
    version: scene.version,
    source: scene.source,
    elements: scene.elements,
    appState: scene.appState ?? {},
    files: scene.files ?? {},
  };
}
