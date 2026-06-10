import { CartelaRecord } from './cartelas.select';

export function serializeCartelaNumberOnly(
  cartela: Pick<CartelaRecord, 'id' | 'number' | 'createdAt'>,
) {
  return {
    id: cartela.id,
    number: cartela.number,
    createdAt: cartela.createdAt,
  };
}

export function serializeCartelaBoard(cartela: CartelaRecord) {
  return {
    id: cartela.id,
    number: cartela.number,
    createdAt: cartela.createdAt,
    b: cartela.b,
    i: cartela.i,
    n: cartela.n,
    g: cartela.g,
    o: cartela.o,
  };
}

/** @deprecated Use serializeCartelaNumberOnly or serializeCartelaBoard */
export function serializeCartela(cartela: CartelaRecord) {
  return serializeCartelaNumberOnly(cartela);
}
