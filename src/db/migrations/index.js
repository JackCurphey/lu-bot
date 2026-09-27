// Every schema change, in order. Append only: a migration that has run on the
// mini is never edited -- a fix is a new migration.
import settings from './001-settings.js';

export const MIGRATIONS = [settings];
