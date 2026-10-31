import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const root = join(import.meta.dir, '../src');
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(dir, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(dir, entry.name)]
        : [],
  );
}

function imports(path: string) {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  return source.statements
    .filter(ts.isImportDeclaration)
    .map((statement) => (statement.moduleSpecifier as ts.StringLiteral).text);
}

describe('module boundaries', () => {
  test('routes do not own SQL, connections, or storage error codes', () => {
    for (const path of files(join(root, 'routes'))) {
      expect(imports(path).filter((name) => /(?:^postgres$|\/db(?:\/index)?$)/.test(name))).toEqual(
        [],
      );
      const source = readFileSync(path, 'utf8');
      expect(source).not.toMatch(/\b(?:db|tx)\s*(?:<[^`]+>)?`/);
      expect(source).not.toMatch(/\b(?:23505|23503|23P01)\b/);
    }
  });

  test('contracts are independent of transport and storage', () => {
    for (const path of files(join(root, 'contracts'))) {
      expect(
        imports(path).filter((name) =>
          /hono|postgres|\/(?:db|routes|services|middleware)(?:\/|$)/.test(name),
        ),
      ).toEqual([]);
    }
  });

  test('persistence and pure clinical rules do not depend on HTTP', () => {
    for (const path of [...files(join(root, 'db')), ...files(join(root, 'clinical'))]) {
      expect(
        imports(path).filter((name) => /hono|\/(?:routes|middleware)(?:\/|$)/.test(name)),
      ).toEqual([]);
    }
    for (const path of files(join(root, 'clinical'))) {
      expect(imports(path).filter((name) => /\/(?:db|services|config)(?:\/|$)/.test(name))).toEqual(
        [],
      );
    }
  });
});
