export type MimeType = string;
export type MimeTypes = MimeType[];

export enum DataFormat {
    UNSPECIFIED,
    S_LE,
    S_BE,
    U_LE,
    U_BE
}

export enum DataLayout {
    UNSPECIFIED,
    INTERLEAVED,
    PROGRESSIVE
}

export enum SampleDepth {
    UNSPECIFIED = 0,
    VARIABLE = Infinity,
    FOUR = 4,
    EIGHT = 8,
    TWELVE = 12,
    SIXTEEN = 16,
    THIRTYTWO = 32
}

export class PayloadDescriptor {
    mimeType: MimeType;

    sampleDuration: number;
    sampleDepth: SampleDepth;
    dataFormat: DataFormat;
    dataLayout: DataLayout;

    details: Object;

    constructor(mimeType) {
        this.mimeType = mimeType;
        this.sampleDuration = 0;;
        this.dataFormat = DataFormat.UNSPECIFIED;
        this.dataLayout = DataLayout.UNSPECIFIED;
    }

    getSampleSize(): number {
        return this.sampleDepth / 8;
    }

    getSamplingRate(): number {
        return (1 / this.sampleDuration);
    }
}
