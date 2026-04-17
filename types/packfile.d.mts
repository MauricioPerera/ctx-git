export function parsePackfile(packData: any): Promise<{
    version: number;
    numObjects: number;
    objects: {
        type: number;
        typeName: any;
        size: number;
        offset: any;
        data: Uint8Array<any>;
        baseOffset: number;
        baseOid: string;
        nextOffset: any;
    }[];
}>;
export const OBJ_COMMIT: 1;
export const OBJ_TREE: 2;
export const OBJ_BLOB: 3;
export const OBJ_TAG: 4;
export const OBJ_OFS_DELTA: 6;
export const OBJ_REF_DELTA: 7;
export const TYPE_NAMES: {
    1: string;
    2: string;
    3: string;
    4: string;
    6: string;
    7: string;
};
