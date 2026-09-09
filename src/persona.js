import { readFile } from 'node:fs/promises';

export function loadPersona(path) {
  return readFile(path, 'utf8');
}
