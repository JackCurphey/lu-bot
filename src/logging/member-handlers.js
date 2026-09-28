import { memberView } from './views.js';
import { formatMemberJoined, formatMemberLeft, formatNicknameChanged, formatRolesChanged } from './format.js';

export function createMemberLogHandlers({ router, now = Date.now }) {
  return {
    async onJoin(member, { guildId }) {
      const v = memberView(member);
      await router.post(guildId, 'members', formatMemberJoined(v, { now }));
    },
    async onLeave(member, { guildId }) {
      const v = memberView(member);
      await router.post(guildId, 'members', formatMemberLeft(v, { now }));
    },
    async onUpdate([before, after], { guildId }) {
      // No "before" to compare: say nothing rather than invent a change.
      if (!before || before.partial) return;
      const b = memberView(before);
      const a = memberView(after);
      if (b.nickname !== a.nickname) {
        await router.post(guildId, 'memberChanges', formatNicknameChanged({ ...a, before: b.nickname, after: a.nickname }, { now }));
      }
      const added = (a.roleIds ?? []).filter((id) => !(b.roleIds ?? []).includes(id));
      const removed = (b.roleIds ?? []).filter((id) => !(a.roleIds ?? []).includes(id));
      if (added.length || removed.length) {
        await router.post(guildId, 'memberChanges', formatRolesChanged({ ...a, added, removed }, { now }));
      }
    },
  };
}
