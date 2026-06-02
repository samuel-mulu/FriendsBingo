import { CartelaRecord } from './cartelas.select';

export function serializeCartela(cartela: CartelaRecord) {
  return {
    ...cartela,
  };
}
