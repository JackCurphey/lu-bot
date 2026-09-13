// Every refusal on the learn path carries a code, never a message meant for a
// human. The command layer maps codes to fixed lines (src/corpus/commands.js):
// relaying a remote server's error text into Discord would put words Lu was
// never given into his mouth, which is the same rule CREDITS_DISABLED exists
// to enforce.
export class LearnError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = 'LearnError';
    this.code = code;
  }
}
