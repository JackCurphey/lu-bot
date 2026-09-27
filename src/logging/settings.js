// Where each kind of log goes, and what it skips. The only reader and writer
// of the "logging" feature's settings rows.
export const LOG_CATEGORIES = Object.freeze(['messages', 'members', 'memberChanges', 'moderation']);

const F = 'logging';

export function createLogSettings(settings) {
  const check = (c) => {
    if (!LOG_CATEGORIES.includes(c)) throw new Error(`Unknown log category "${c}"`);
  };
  const list = (g, key) => settings.get(g, F, key, []);
  const add = (g, key, id) => {
    const current = list(g, key);
    if (current.includes(id)) return false;
    settings.set(g, F, key, [...current, id]);
    return true;
  };
  const drop = (g, key, id) => {
    const current = list(g, key);
    if (!current.includes(id)) return false;
    settings.set(g, F, key, current.filter((x) => x !== id));
    return true;
  };

  return {
    route(g, c) { check(c); return settings.get(g, F, `route.${c}`, null); },
    setRoute(g, c, channelId) {
      check(c);
      settings.set(g, F, `route.${c}`, channelId);
      settings.remove(g, F, `broken.${c}`);
    },
    clearRoute(g, c) {
      check(c);
      settings.remove(g, F, `route.${c}`);
      settings.remove(g, F, `broken.${c}`);
    },
    // Switched off, with the reason kept for /log status. Re-setting the
    // route is the way back on.
    markBroken(g, c, info) {
      check(c);
      settings.remove(g, F, `route.${c}`);
      settings.set(g, F, `broken.${c}`, info);
    },
    broken(g, c) { check(c); return settings.get(g, F, `broken.${c}`, null); },
    isLogChannel: (g, channelId) => LOG_CATEGORIES.some((c) => settings.get(g, F, `route.${c}`, null) === channelId),
    ignoreChannel: (g, id) => add(g, 'ignore.channels', id),
    unignoreChannel: (g, id) => drop(g, 'ignore.channels', id),
    ignoreRole: (g, id) => add(g, 'ignore.roles', id),
    unignoreRole: (g, id) => drop(g, 'ignore.roles', id),
    isIgnoredChannel: (g, id) => list(g, 'ignore.channels').includes(id),
    isIgnoredRole: (g, id) => list(g, 'ignore.roles').includes(id),
    ignored: (g) => ({ channels: list(g, 'ignore.channels'), roles: list(g, 'ignore.roles') }),
  };
}
