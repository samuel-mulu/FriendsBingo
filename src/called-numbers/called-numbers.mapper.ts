import { CalledNumberRecord } from './called-numbers.select';

export function serializeCalledNumber(calledNumber: CalledNumberRecord) {
  return {
    ...calledNumber,
  };
}
