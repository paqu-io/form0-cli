import { normalizeFieldValue } from 'form0-core';

/** Server and browser preview share the core input contract. */
export const normalizeChoiceOperationValue = (field, value) => normalizeFieldValue(field, value);
