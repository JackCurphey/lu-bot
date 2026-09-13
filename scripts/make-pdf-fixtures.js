// Builds the two PDFs test/corpus-pdf.test.js reads. Run by hand when the
// fixtures need regenerating; its output is committed, so the test suite never
// touches the network or shells out.
//
// Hand-assembled rather than produced by a library: the fixtures exist to
// prove the extractor's contract, and a fixture built by a dependency would
// make the test partly a test of that dependency.
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function pdf(objects) {
  let out = Buffer.from('%PDF-1.4\n', 'latin1');
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out = Buffer.concat([out, Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
  });
  const xref = out.length;
  let tail = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) tail += `${String(offset).padStart(10, '0')} 00000 n \n`;
  tail += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.concat([out, Buffer.from(tail, 'latin1')]);
}

function withText(text) {
  const stream = Buffer.from(`BT /F1 12 Tf 72 720 Td (${text}) Tj ET`, 'latin1');
  return pdf([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'latin1'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', 'latin1'),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'latin1'), stream, Buffer.from('\nendstream', 'latin1')]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', 'latin1'),
  ]);
}

// No content stream at all: what a scanned page looks like to a text
// extractor, which is the case L7 refuses.
function withoutText() {
  return pdf([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'latin1'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>', 'latin1'),
  ]);
}

const dir = join(import.meta.dirname, '..', 'test', 'fixtures');
await mkdir(dir, { recursive: true });
await writeFile(join(dir, 'probe.pdf'), withText('The material conditions of the fixture are not in doubt.'));
await writeFile(join(dir, 'no-text.pdf'), withoutText());
console.log(`Wrote fixtures to ${dir}`);
