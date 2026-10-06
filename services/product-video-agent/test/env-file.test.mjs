import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { upsertEnvValues } from '../../lib/env-file.mjs';

test('upsertEnvValues updates named values without disturbing unrelated entries', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'orion-env-file-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const filePath = join(directory, '.env');
  writeFileSync(filePath, 'UNCHANGED=value\nTOKEN=old\n', 'utf8');

  const result = upsertEnvValues(filePath, {
    TOKEN: 'new',
    REFRESH_TOKEN: 'refresh',
  });

  assert.deepEqual(result.keys, ['TOKEN', 'REFRESH_TOKEN']);
  assert.equal(readFileSync(filePath, 'utf8'), [
    'UNCHANGED=value',
    'TOKEN=new',
    'REFRESH_TOKEN=refresh',
    '',
  ].join('\n'));
});

test('upsertEnvValues rejects newline injection', () => {
  assert.throws(
    () => upsertEnvValues('unused', { TOKEN: 'value\nINJECTED=true' }),
    /cannot contain a newline/u,
  );
});
