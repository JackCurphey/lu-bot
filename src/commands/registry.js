import { PermissionFlagsBits } from 'discord.js';

// "BanMembers" -> "Ban Members", for refusal messages people read.
const spaced = (flag) => flag.replace(/([a-z])([A-Z])/g, '$1 $2');

// Every slash command goes through here. Each command declares a Discord
// default permission; the handler then re-checks it, because an admin can
// loosen the default in Server Settings -> Integrations and that must never
// let a member without the power use it.
export function createCommandRegistry() {
  const commands = new Map();

  return {
    register(command) {
      if (commands.has(command.name)) throw new Error(`Command /${command.name} is already registered`);
      if (command.permission && !(command.permission in PermissionFlagsBits)) {
        throw new Error(`Command /${command.name} names unknown permission "${command.permission}"`);
      }
      commands.set(command.name, command);
    },

    definitions() {
      return [...commands.values()].map((c) => ({
        name: c.name,
        description: c.description,
        options: c.options ?? [],
        ...(c.permission ? { default_member_permissions: PermissionFlagsBits[c.permission].toString() } : {}),
      }));
    },

    async handle(view, io) {
      const command = commands.get(view.commandName);
      if (!command) {
        await io.reply({ content: "I don't know that command. It may be from an older version of me." });
        return;
      }
      if (!view.guildId) {
        await io.reply({ content: 'That only works in a server.' });
        return;
      }
      const perms = view.memberPermissions ?? [];
      if (command.permission && !perms.includes('Administrator') && !perms.includes(command.permission)) {
        await io.reply({ content: `You need the ${spaced(command.permission)} permission to use /${command.name}.` });
        return;
      }
      try {
        await command.run({ view, reply: io.reply });
      } catch (err) {
        console.error(`/${command.name} failed:`, err);
        // Best effort: the interaction may already have been answered, and a
        // second failure here must not escape either.
        await io.reply({ content: 'Something went wrong running that. It has been logged.' }).catch(() => {});
      }
    },
  };
}
