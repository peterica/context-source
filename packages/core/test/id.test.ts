import { describe, expect, it } from 'vitest';
import {
  externalModuleEntityId,
  fileEntityId,
  normalizeFilePath,
  symbolEntityId,
} from '../src/id.js';

describe('Entity id rules (DATA-MODEL.md §1)', () => {
  it('file id matches {projectId}/file:{filePath}', () => {
    expect(fileEntityId('p1', 'src/payment/service.ts')).toBe('p1/file:src/payment/service.ts');
  });

  it('symbol id matches {projectId}/sym:{filePath}#{symbolPath}', () => {
    expect(symbolEntityId('p1', 'src/payment/service.ts', 'PaymentService.charge')).toBe(
      'p1/sym:src/payment/service.ts#PaymentService.charge',
    );
  });

  it('external module id matches {projectId}/ext:{packageName}', () => {
    expect(externalModuleEntityId('p1', 'lodash')).toBe('p1/ext:lodash');
    expect(externalModuleEntityId('p1', '@nestjs/core')).toBe('p1/ext:@nestjs/core');
  });

  it('normalizes backslashes and leading ./ in file paths', () => {
    expect(normalizeFilePath('src\\a\\b.ts')).toBe('src/a/b.ts');
    expect(normalizeFilePath('./src/a.ts')).toBe('src/a.ts');
  });

  it('id is independent of in-file line position (same symbolPath => same id)', () => {
    const a = symbolEntityId('p1', 'src/a.ts', 'foo');
    const b = symbolEntityId('p1', 'src/a.ts', 'foo');
    expect(a).toBe(b);
  });

  it('renaming the symbol or moving the file yields a different id', () => {
    const original = symbolEntityId('p1', 'src/a.ts', 'foo');
    const renamed = symbolEntityId('p1', 'src/a.ts', 'bar');
    const moved = symbolEntityId('p1', 'src/b.ts', 'foo');
    expect(renamed).not.toBe(original);
    expect(moved).not.toBe(original);
  });
});
