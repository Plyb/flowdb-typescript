export type Extern = { __externBrand: true }
export const extern: Extern = { __externBrand: true }
export function isExtern(lattice: any): lattice is Extern {
    return lattice === extern;
}
