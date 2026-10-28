import type { ContentiaResult } from 'contentia/core';
import { ValidationError } from 'contentia/core';
import * as Result from 'effect/Result';
import * as S from 'effect/Schema';
import type { JSONSchema7 } from 'json-schema';
import type { Catalog } from '../entities/catalog.js';
import { CatalogSchema } from '../entities/catalog.js';

export const createDefaultSchema = (): JSONSchema7 => ({
  type: 'object',
  properties: {},
  additionalProperties: true,
});

export const createDefaultCatalog = (): Catalog => ({
  collections: {},
});

export const parseCatalogJSON = (json: string): ContentiaResult<Catalog> => {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (error) {
    console.error(error);
    return Result.fail(
      new ValidationError(
        'The .contentia/catalog document is not valid JSON and could not be parsed.',
      ),
    );
  }

  return parseCatalog(data);
};

export const parseCatalog = (
  data: unknown,
): ContentiaResult<Catalog> => {
  try {
    const decoded = S.decodeUnknownSync(CatalogSchema)(data);
    return Result.succeed(decoded);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Result.fail(new ValidationError('Invalid settings data: ' + message));
  }
};
