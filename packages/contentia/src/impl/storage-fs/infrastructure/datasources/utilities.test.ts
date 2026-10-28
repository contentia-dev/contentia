import { BadRequestError, ConflictError, ForbiddenError, InternalError, NotFoundError } from 'contentia/core';
import { describe, expect, it } from 'vitest';
import { mapFsErrorToContentiaError } from './utilities.js';

function fsError(code: string): NodeJS.ErrnoException {
  const e = new Error(code) as NodeJS.ErrnoException;
  e.code = code;
  return e;
}

describe('mapFsErrorToContentiaError', () => {
  it('maps EACCES (single-S) to ForbiddenError', () => {
    const result = mapFsErrorToContentiaError(fsError('EACCES'));
    expect(result).toBeInstanceOf(ForbiddenError);
  });

  it('maps ENOENT to NotFoundError', () => {
    const result = mapFsErrorToContentiaError(fsError('ENOENT'));
    expect(result).toBeInstanceOf(NotFoundError);
  });

  it('maps EEXIST to ConflictError', () => {
    const result = mapFsErrorToContentiaError(fsError('EEXIST'));
    expect(result).toBeInstanceOf(ConflictError);
  });

  it('maps EPERM to ForbiddenError', () => {
    const result = mapFsErrorToContentiaError(fsError('EPERM'));
    expect(result).toBeInstanceOf(ForbiddenError);
  });

  it('maps ENAMETOOLONG to BadRequestError with actionable message', () => {
    const result = mapFsErrorToContentiaError(fsError('ENAMETOOLONG'));
    expect(result).toBeInstanceOf(BadRequestError);
    expect(result.message).toContain('255');
  });

  it('maps unknown codes to InternalError', () => {
    const result = mapFsErrorToContentiaError(fsError('EUNKNOWN_CUSTOM'));
    expect(result).toBeInstanceOf(InternalError);
  });

  it('passes through an existing ContentiaError unchanged', () => {
    const original = new NotFoundError('already a contentia error');
    const result = mapFsErrorToContentiaError(original);
    expect(result).toBe(original);
  });

  it('maps a plain Error with no code to InternalError', () => {
    const result = mapFsErrorToContentiaError(new Error('oops'));
    expect(result).toBeInstanceOf(InternalError);
  });

  it('maps a non-Error value to InternalError', () => {
    const result = mapFsErrorToContentiaError('something went wrong');
    expect(result).toBeInstanceOf(InternalError);
  });
});
