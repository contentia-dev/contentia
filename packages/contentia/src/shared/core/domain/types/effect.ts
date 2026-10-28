import type { Result } from 'effect/Result';
import type { ContentiaError } from '../entities/index.js';

export type ContentiaResult<T> = Result<T, ContentiaError>;
